// Final composite: shades the primary scene and blends the accumulated SSR
// reflection over the floor mirror using the stored confidence as the blend
// weight. Non-reflective surfaces and the sky pass through unchanged.
#include "Common.hlsli"
ConstantBuffer<CameraCB> CB : register(b1);
Texture2D<float4> GAlbedo   : register(t1);
Texture2D<float3> GWorldN   : register(t4);
Texture2D<uint>   GFlags    : register(t6);
Texture2D<float4> HistColor : register(t7);
SamplerState PointClamp : register(s0);

float4 PSMain(float4 p:SV_POSITION): SV_Target0 {
    int2 dims; GAlbedo.GetDimensions(dims.x, dims.y);
    int2 ip=int2(p.xy);
    float3 alb = GAlbedo.Load(int3(ip,0)).rgb;
    float3 wn  = GWorldN.Load(int3(ip,0));
    uint flags = GFlags.Load(int3(ip,0));
    float3 ld = normalize(float3(-0.45f,0.80f,-0.35f));
    float3 base = alb*(saturate(dot(wn,ld))*0.75f+0.25f) + SampleSky(wn)*0.15f;
    if((flags & GFLAG_GROUND)!=0u){
        float4 h = HistColor.Load(int3(ip,0));
        float w = saturate(h.a) * 0.55f;          // confidence-driven blend
        float3 floorCol = alb*0.35f;
        return float4(lerp(floorCol, h.rgb, w) + floorCol*(1.0f-w)*0.0f, 1.0f);
    }
    return float4(base, 1.0f);
}
