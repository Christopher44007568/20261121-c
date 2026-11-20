// G-buffer pass: writes linear view depth, view/world normals and positions,
// albedo and material flags. Mirrors reference/ssr_gbuffer.hpp.
#include "Common.hlsli"
ConstantBuffer<CameraCB> CB : register(b0);

struct VSIn  { float3 pos:POSITION; float3 norm:NORMAL; float3 alb:COLOR; uint flags:BLENDINDICES0; };
struct VSOut {
    float4 clip:SV_POSITION;
    float3 worldPos:WORLDPOS;
    float3 worldNorm:WORLDNORM;
    float3 albedo:ALBEDO;
    uint flags:FLAGS;
};

VSOut VSMain(VSIn i){
    VSOut o;
    o.worldPos = i.pos;
    o.worldNorm = normalize(i.norm);
    o.albedo = i.alb;
    o.flags = i.flags;
    o.clip = mul(CB.viewProj, float4(i.pos, 1.0f));
    return o;
}

struct GBMRT {
    float4 linDepthView : SV_Target0; // x linear view depth, y depth, z unused, w unused
    float4 viewNormal   : SV_Target1; // xyz
    float4 worldNormal  : SV_Target2; // xyz
    float4 worldPos     : SV_Target3; // xyz
    float4 albedo       : SV_Target4; // rgb
    uint   flags        : SV_Target5; // R32_UINT
};

GBMRT PSMain(VSOut i, float4 clip:SV_POSITION){
    GBMRT o;
    float3 viewPos = mul(CB.view, float4(i.worldPos, 1.0f)).xyz;
    o.linDepthView = float4(viewPos.z, clip.z, 0.0f, 1.0f);
    o.viewNormal = float4(normalize(mul((float3x3)CB.view, i.worldNorm)), 0.0f);
    o.worldNormal = float4(i.worldNorm, 0.0f);
    o.worldPos = float4(i.worldPos, 1.0f);
    o.albedo = float4(i.albedo, 1.0f);
    o.flags = i.flags;
    return o;
}
