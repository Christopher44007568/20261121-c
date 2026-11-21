#pragma once

// One HLSL source, several entry points. Compiled at runtime via
// D3DCompile (d3dcompiler_47.dll, inbox on Windows 8.1+).
static const char* kShaderSource = R"HLSL(
cbuffer PerDraw : register(b0)
{
    float4x4 gWorld;
    float4x4 gViewProj;
    float4 gLightDir;   // xyz = dir toward light, w = exposure
    float4 gCamPos;     // w = time
    float4 gTint;       // rgb = albedo tint, a = force-opaque flag
};

Texture2D gHairTex : register(t0);
SamplerState gSamp : register(s0);

struct VSIn
{
    float3 pos : POSITION;
    float3 nrm : NORMAL;
    float2 uv  : TEXCOORD0;
};

struct PSIn
{
    float4 pos : SV_POSITION;
    float3 nrm : NORMAL;
    float2 uv  : TEXCOORD0;
    float3 wp  : TEXCOORD1;
};

PSIn VSMain(VSIn i)
{
    PSIn o;
    float4 wp = mul(float4(i.pos, 1.0), gWorld);
    o.pos = mul(wp, gViewProj);
    o.nrm = normalize(mul(i.nrm, (float3x3)gWorld));
    o.uv  = i.uv;
    o.wp  = wp.xyz;
    return o;
}

float3 Shade(float3 albedo, float3 n, float3 wp)
{
    float3 L = normalize(gLightDir.xyz);
    float dif = saturate(dot(n, L)) * 0.85 + 0.15; // lambert + ambient
    // simple view-dependent rim so edges shimmer while the camera scrolls
    float3 V = normalize(gCamPos.xyz - wp);
    float rim = pow(1.0 - saturate(dot(n, V)), 2.0) * 0.25;
    return albedo * (dif + rim) * gLightDir.w;
}

float4 PSOpaque(PSIn i) : SV_TARGET
{
    return float4(Shade(gTint.rgb, normalize(i.nrm), i.wp), 1.0);
}

// Alpha-to-coverage path: alpha leaves the shader, hardware converts it
// into a per-sample coverage mask when AlphaToCoverageEnable is set.
float4 PSHairA2C(PSIn i) : SV_TARGET
{
    float4 t = gHairTex.Sample(gSamp, i.uv);
    float3 n = normalize(i.nrm);
    n = (dot(n, gCamPos.xyz - i.wp) < 0.0) ? -n : n; // double-sided
    return float4(Shade(t.rgb, n, i.wp), t.a);
}

// Alpha-test path: whole pixel kept or killed at the pixel center.
// MSAA cannot soften the textured edge because the decision is per-pixel.
float4 PSHairClip(PSIn i) : SV_TARGET
{
    float4 t = gHairTex.Sample(gSamp, i.uv);
    clip(t.a - 0.5);
    float3 n = normalize(i.nrm);
    n = (dot(n, gCamPos.xyz - i.wp) < 0.0) ? -n : n;
    return float4(Shade(t.rgb, n, i.wp), 1.0);
}

// Debug: visualize the per-sample coverage mask produced by A2C.
// Green intensity = number of covered MSAA samples (0..4 at 4x).
float4 PSHairCoverage(PSIn i, uint cov : SV_Coverage) : SV_TARGET
{
    float4 t = gHairTex.Sample(gSamp, i.uv);
    float covered = (float)countbits(cov);
    float total = max(gTint.a, 1.0); // sample count passed via tint.a
    float g = covered / total;
    // keep the A2C state active so the mask on screen matches the mask here
    return float4(0.05, g, 0.15 + 0.35 * t.a, t.a);
}
)HLSL";
