#ifndef SSS_MATERIAL_HLSL
#define SSS_MATERIAL_HLSL

#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
#include "Packages/com.unity.render-pipelines.high-definition/Runtime/ShaderLibrary/ShaderVariables.hlsl"

CBUFFER_START(UnityPerMaterial)
    float4 _BaseColor;
    float4 _SpecularTint;
    float  _Smoothness;
    float  _MaterialID;
    float  _VertexThickness;
    float  _ThicknessScale;
    float  _WorldScale;
    float  _EnableSSS;
CBUFFER_END

// Directional key light, normalised direction (toward the light) and intensity.
CBUFFER_START(SSSGlobalFrame)
    float4 _SSSKeyLightDir;   // xyz direction, w intensity
    float4 _SSSKeyLightColor; // rgb color,   w unused
    float4 _SSSAmbient;       // rgb ambient, w unused
CBUFFER_END

struct Attributes
{
    float4 positionOS : POSITION;
    float3 normalOS   : NORMAL;
    float4 color      : COLOR;      // r = thickness multiplier, g = light mask, b = unused
};

struct Varyings
{
    float4 positionCS : SV_POSITION;
    float3 positionWS : TEXCOORD0;
    float3 normalWS   : TEXCOORD1;
    float4 color      : TEXCOORD2;
};

Varyings Vert(Attributes input)
{
    Varyings output;
    float3 scaledOS = input.positionOS.xyz * _WorldScale;
    output.positionCS = TransformWorldToHClip(mul(UNITY_MATRIX_M, float4(scaledOS, 1.0)).xyz);
    output.positionWS = mul(UNITY_MATRIX_M, float4(scaledOS, 1.0)).xyz;
    output.normalWS   = normalize(mul((float3x3)UNITY_MATRIX_M, input.normalOS));
    output.color      = input.color;
    return output;
}

// Thickness is authored per vertex (auricle 0.45-2.4 mm, backing plate 40 mm)
// and multiplied by the mesh's thickness multiplier in the vertex color channel.
float ComputeThickness(Varyings input)
{
    return max(_VertexThickness * input.color.r * _ThicknessScale, 0.00005);
}

// Simple direct lighting: wrapped diffuse with a hard key light, ambient floor
// and a Blinn-Phong style specular highlight. The green vertex channel lets the
// edge measurement cards carry an infinitely hard light boundary.
float4 FragBeauty(Varyings input) : SV_Target0
{
    float3 normalWS   = normalize(input.normalWS);
    float3 lightDir   = normalize(_SSSKeyLightDir.xyz);
    float  ndl        = dot(normalWS, lightDir);
    float  hardMask   = input.color.g;
    float  diffuse    = saturate(hardMask > 0.0 ? hardMask : ndl * 0.5 + 0.5);
    float3 radiance   = _BaseColor.rgb * diffuse * _SSSKeyLightColor.rgb * _SSSKeyLightDir.w;

    float3 viewDir    = normalize(GetWorldSpaceViewDir(input.positionWS));
    float3 halfDir    = normalize(lightDir + viewDir);
    float  specPower  = lerp(16.0, 256.0, _Smoothness);
    float  specular   = pow(saturate(dot(normalWS, halfDir)), specPower) * _Smoothness;
    radiance         += specular * _SpecularTint.rgb * _SSSKeyLightColor.rgb * _SSSKeyLightDir.w;
    radiance         += _BaseColor.rgb * _SSSAmbient.rgb;

    return float4(radiance, 1.0);
}

// R = quantised material ID / 255, G = thickness normalised to 80 mm,
// B = raw thickness in millimetres (debug), A = SSS participation flag.
float4 FragIDThickness(Varyings input) : SV_Target0
{
    float  thicknessM  = ComputeThickness(input);
    float  idEncoded   = round(_MaterialID) / 255.0;
    float  thickness80 = saturate(thicknessM / 0.08);
    return float4(idEncoded, thickness80, thicknessM * 1000.0 / 80.0, _EnableSSS);
}

#endif
