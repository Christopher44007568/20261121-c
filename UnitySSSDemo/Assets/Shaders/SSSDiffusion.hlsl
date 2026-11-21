#ifndef SSS_DIFFUSION_HLSL
#define SSS_DIFFUSION_HLSL

#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
#include "Packages/com.unity.render-pipelines.high-definition/Runtime/ShaderLibrary/ShaderVariables.hlsl"
#include "SSSProfile.hlsl"

TEXTURE2D_X(_SSSBeautyTex);
TEXTURE2D_X(_SSSIDTex);
TEXTURE2D_X(_SSSThicknessTex);
TEXTURE2D_X(_SSSDiffuseTex);
TEXTURE2D_X(_SSSCameraDepthTex);

SAMPLER(sampler_SSSBeautyTex);
SAMPLER(sampler_SSSIDTex);
SAMPLER(sampler_SSSThicknessTex);
SAMPLER(sampler_SSSDiffuseTex);
SAMPLER(sampler_SSSCameraDepthTex);

CBUFFER_START(SSSDiffusion)
    float  _SSSRadiusScale;     // multiplies world-space profile radii
    float  _SSSEnabled;         // 0 = hard direct step only
    float  _SSSIDGateEnabled;   // 0 = reference mode without the material firewall
    float  _SSSInvHeight;       // 1 / render target height in pixels
    float4 _SSSDebugMode;       // x: 0 beauty, 1 id, 2 thickness, 3 composite
CBUFFER_END

static const int   SSS_TAP_COUNT = 48;
// 48 taps per axis at half-pixel spacing span +/- 24 px, covering the widest
// calibrated lobe (sigma ~ 7.6 px at 1x after the separable scale) out to
// ~3.2 sigma. Two axes give a 96-tap diffusion footprint.
static const float SSS_TAP_SPACING = 0.5;

struct FullscreenVaryings
{
    float4 positionCS : SV_POSITION;
    float2 uv         : TEXCOORD0;
};

FullscreenVaryings FullscreenVert(uint vertexID : SV_VertexID)
{
    FullscreenVaryings output;
    output.uv         = GetFullScreenTriangleTexCoord(vertexID);
    output.positionCS = GetFullScreenTriangleVertexPosition(vertexID);
    return output;
}

// World metres per pixel at this fragment, derived from the HDRP camera
// matrices. The diffusion profile is authored in world units and converted
// back to pixels every frame: this is the term that keeps the screen-space
// footprint constant when geometry, camera distance and profile scale together.
float MetersPerPixel(float2 uv)
{
    // Rebuild the world position at the near plane directly from the inverse
    // view-projection matrix, then measure the world height of one pixel at
    // the fragment's actual camera distance.
    float2 depthUV       = saturate(uv);
    float  rawDepth      = SAMPLE_TEXTURE2D_X_LOD(_SSSCameraDepthTex, sampler_SSSCameraDepthTex, depthUV, 0).x;
    float3 positionWS    = ComputeWorldSpacePosition(uv, rawDepth, UNITY_MATRIX_I_VP);
    float  distanceToCam = distance(GetPrimaryCameraPosition(), positionWS);

    float4 topNearCS = float4(0.0, 1.0, _ProjectionParams.y, 1.0);
    float4 botNearCS = float4(0.0, -1.0, _ProjectionParams.y, 1.0);
    float3 topNearWS = mul(UNITY_MATRIX_I_VP, topNearCS).xyz / topNearCS.w;
    float3 botNearWS = mul(UNITY_MATRIX_I_VP, botNearCS).xyz / botNearCS.w;
    float  worldHeightAtNear = distance(topNearWS, botNearWS);
    float  worldHeight = worldHeightAtNear * (distanceToCam / max(_ProjectionParams.y, 1e-5));
    return worldHeight * _SSSInvHeight;
}

float DecodeID(float4 idSample)
{
    return round(idSample.r * 255.0);
}

// One separable diffusion axis. All three Gaussian lobes are evaluated in the
// same 48-tap loop; the resulting footprint totals 96 taps after both passes.
float4 DiffuseAxis(FullscreenVaryings input, float2 axis)
{
    float2 uv          = input.uv;
    float  metresPerPx = MetersPerPixel(uv);
    float  centerID    = DecodeID(SAMPLE_TEXTURE2D_X_LOD(_SSSIDTex, sampler_SSSIDTex, uv, 0));

    float3 sigmaPx[3];
    [unroll]
    for (int k = 0; k < 3; ++k)
        sigmaPx[k] = (SSS_LobeRadiusM[k] * SSS_SEPARABLE_KERNEL_SCALE * _SSSRadiusScale)
                   / max(metresPerPx, 1e-7);

    float3 accumulated[3] = { float3(0,0,0), float3(0,0,0), float3(0,0,0) };
    float3 weightSum[3]   = { float3(0,0,0), float3(0,0,0), float3(0,0,0) };

    [loop]
    for (int tap = -SSS_TAP_COUNT; tap <= SSS_TAP_COUNT; ++tap)
    {
        float  dPx   = tap * SSS_TAP_SPACING;
        float2 tapUV = uv + axis * dPx * _ScreenSize.zw;

        float  tapID = DecodeID(SAMPLE_TEXTURE2D_X_LOD(_SSSIDTex, sampler_SSSIDTex, tapUV, 0));
        // Material firewall: a mismatched ID contributes zero weight, so the
        // footprint collapses at the seam instead of bleeding across it.
        float  gate  = (_SSSIDGateEnabled > 0.5) ? (abs(tapID - centerID) < 0.5 ? 1.0 : 0.0) : 1.0;
        float3 color = SAMPLE_TEXTURE2D_X_LOD(_SSSBeautyTex, sampler_SSSBeautyTex, tapUV, 0).rgb;

        [unroll]
        for (int k = 0; k < 3; ++k)
        {
            float3 w = SSS_GaussianWeight(dPx, sigmaPx[k]) * gate;
            accumulated[k] += color * w;
            weightSum[k]   += w;
        }
    }

    float3 result = float3(0, 0, 0);
    [unroll]
    for (int k = 0; k < 3; ++k)
        result += SSS_LobeWeight[k] * (accumulated[k] / max(weightSum[k], 1e-5));
    return float4(result, 1.0);
}

float4 FragH(FullscreenVaryings input) : SV_Target
{
    return DiffuseAxis(input, SSS_DIRECTION);
}

float4 FragV(FullscreenVaryings input) : SV_Target
{
    return DiffuseAxis(input, SSS_DIRECTION);
}

// Recombine direct lighting with the diffuse transport. Thickness modulates the
// scattered energy with Beer-Lambert transmission; the 40 mm backing plate ends
// up with effectively zero scattered response while the thin auricle keeps it.
float4 FragComposite(FullscreenVaryings input) : SV_Target
{
    float2 uv       = input.uv;
    float4 direct   = SAMPLE_TEXTURE2D_X_LOD(_SSSBeautyTex, sampler_SSSBeautyTex, uv, 0);
    float4 idBuffer = SAMPLE_TEXTURE2D_X_LOD(_SSSIDTex, sampler_SSSIDTex, uv, 0);
    float4 diffuse  = SAMPLE_TEXTURE2D_X_LOD(_SSSDiffuseTex, sampler_SSSDiffuseTex, uv, 0);

    float  thicknessM = idBuffer.g * 0.08;
    float3 transmit   = SSS_Transmission(thicknessM);
    float  participates = idBuffer.a;

    if (_SSSDebugMode.x > 1.5 && _SSSDebugMode.x < 2.5)
        return float4(idBuffer.g, saturate(thicknessM / 0.08), 0.25, 1.0);
    if (_SSSDebugMode.x > 0.5 && _SSSDebugMode.x < 1.5)
        return float4(idBuffer.r, idBuffer.r, idBuffer.r, 1.0);

    if (_SSSEnabled < 0.5 || participates < 0.5)
        return direct;

    float3 scattered = diffuse.rgb * transmit * SSS_ScatterTint;
    return float4(direct.rgb + scattered, 1.0);
}

#endif
