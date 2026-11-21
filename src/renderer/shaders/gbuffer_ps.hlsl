#include "common.hlsli"

// RT0: HDR linear color with Cook-Torrance PBR shading.
struct GbPsOut
{
    float4 color : SV_Target0;
    float2 velocity : SV_Target1;
    float  linearDepth : SV_Target2;
};

static const float PI = 3.14159265f;

float DistributionGGX(float3 n, float3 h, float rough)
{
    float a = rough * rough;
    float a2 = a * a;
    float ndh = max(dot(n, h), 0.0f);
    float d = ndh * ndh * (a2 - 1.0f) + 1.0f;
    return a2 / max(PI * d * d, 1e-7f);
}

float GeometrySchlick(float cosTheta, float rough)
{
    float r = rough + 1.0f;
    float k = (r * r) / 8.0f;
    return cosTheta / (cosTheta * (1.0f - k) + k);
}

float3 FresnelSchlick(float cosTheta, float3 f0)
{
    return f0 + (1.0f - f0) * pow(max(1.0f - cosTheta, 0.0f), 5.0f);
}

GbPsOut PSMain(GbOut i)
{
    GbPsOut o;
    float3 n = normalize(i.normalW);
    float3 v = normalize(gCameraPos.xyz - i.positionW);
    float3 l = normalize(-gLightDir.xyz);
    float3 h = normalize(v + l);
    float rough = max(gAlbedoRoughness.w, 0.05f);
    float metal = gMetallic.x;
    float3 albedo = gAlbedoRoughness.xyz;
    float3 f0 = float3(0.04f, 0.04f, 0.04f) * (1.0f - metal) + albedo * metal;

    float ndf = DistributionGGX(n, h, rough);
    float geo = GeometrySchlick(max(dot(n, v), 0.0f), rough)
              * GeometrySchlick(max(dot(n, l), 0.0f), rough);
    float3 fres = FresnelSchlick(max(dot(h, v), 0.0f), f0);
    float3 spec = ndf * geo * fres /
        max(4.0f * max(dot(n, v), 0.0f) * max(dot(n, l), 0.0f), 1e-4f);
    float3 kd = (1.0f - fres) * (1.0f - metal);
    float ndl = max(dot(n, l), 0.0f);
    float3 ambient = albedo * (0.08f + 0.05f * max(n.y, 0.0f));
    o.color.rgb = ambient + (kd * albedo / PI + spec) * (gLightDir.w * ndl);
    o.color.a = 1.0f;

    // Motion vector in current-target pixels. Transform the same local vertex
    // through both frame's world/view/proj; static geometry has identical
    // world matrices and only camera motion remains. Each projection carries
    // its own frame's jitter, so jitter differences cancel in the subtraction.
    float4 localPos = float4(i.positionL, 1.0f);
    float4 prevPos = mul(mul(localPos, gPrevWorld), gPrevViewProj);
    float4 curPos  = mul(mul(localPos, gWorld), gViewProj);
    float2 prevNdc = prevPos.xy / prevPos.w;
    float2 curNdc = curPos.xy / curPos.w;
    float2 renderSize = gParams.zw;
    o.velocity = (curNdc - prevNdc) * 0.5f * renderSize;
    o.linearDepth = length(i.positionW - gCameraPos.xyz);
    return o;
}
