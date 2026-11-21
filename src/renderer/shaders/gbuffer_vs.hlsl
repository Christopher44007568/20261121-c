#include "common.hlsli"

GbOut VSMain(VsIn i)
{
    GbOut o;
    float4 world = mul(float4(i.posLocal, 1.0f), gWorld);
    o.positionW = world.xyz;
    o.normalW = normalize(mul(float4(i.normal, 0.0f), gWorld).xyz);
    o.positionCs = mul(world, gViewProj);
    o.uv = i.posLocal.xy;
    o.positionL = i.posLocal;
    return o;
}
