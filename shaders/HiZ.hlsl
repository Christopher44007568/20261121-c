// Conservative max linear-depth pyramid. Empty texels are +inf; a quad stays
// +inf only when all four children are empty.
#include "Common.hlsli"
Texture2D<float> SrcDepth : register(t0);
SamplerState PointClamp : register(s0);

struct CSOut { float4 dummy:SV_POSITION; };
float PSMain(float4 p:SV_POSITION) : SV_Target {
    uint2 d;
    SrcDepth.GetDimensions(d.x, d.y);
    int2 base = int2(p.xy)*2;
    float farZ = 0.0f; bool any=false;
    [unroll]
    for(int yy=0; yy<2; ++yy) [unroll]
    for(int xx=0; xx<2; ++xx){
        int2 s = min(base + int2(xx,yy), int2(d)-1);
        float z = SrcDepth.Load(int3(s,0));
        if(isfinite(z)){ any=true; farZ=max(farZ,z); }
    }
    return any ? farZ : 1.0f/0.0f;
}
