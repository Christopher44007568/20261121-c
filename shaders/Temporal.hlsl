// Temporal accumulation with explicit history invalidation.
// A history sample is reused only when:
//   * the current pixel still has a valid screen hit (hard rule),
//   * the reprojected point stays on screen and on the ground mirror,
//   * reprojected linear depth matches within TAA_DEPTH_REJ.
// Any hit loss (object off-screen / occluded / max distance) drops the pixel
// straight to the environment fallback, so no previous frame image survives.
#include "Common.hlsli"
ConstantBuffer<CameraCB> CB : register(b1);
Texture2D<float4> CurSSR   : register(t0);
Texture2D<float4> PrevHist : register(t1);
Texture2D<float>  CurLinZ  : register(t2);
Texture2D<float>  PrevLinZ : register(t3);
Texture2D<uint>   CurFlags : register(t4);
Texture2D<uint>   PrevFlags: register(t5);
Texture2D<float3> CurWorld : register(t6);
SamplerState PointClamp : register(s0);

struct Out { float4 color:SV_Target0; float4 meta:SV_Target1; };

Out PSMain(float4 p:SV_POSITION){
    int2 dims; CurSSR.GetDimensions(dims.x, dims.y);
    int2 ip = int2(p.xy);
    float4 cur = CurSSR.Load(int3(ip,0));
    Out o;
    bool reuse=false; float4 histSample=0.0f;
    if(cur.a > 0.0f){
        float3 wp = CurWorld.Load(int3(ip,0));
        float4 h = mul(CB.prevViewProj, float4(wp,1.0f));
        if(h.w > 0.0f){
            float2 uv = float2(h.x/h.w*0.5f+0.5f, 0.5f-h.y/h.w*0.5f);
            if(all(uv>=0.0f) && all(uv<1.0f) &&
               (CurFlags.Load(int3(ip,0)) & GFLAG_GROUND)!=0u){
                int2 pi2 = clamp(int2(uv*float2(dims)), int2(0,0), dims-1);
                if((PrevFlags.Load(int3(pi2,0)) & GFLAG_GROUND)!=0u){
                    float dz = abs(PrevLinZ.Load(int3(pi2,0)) - CurLinZ.Load(int3(ip,0)));
                    if(dz < TAA_DEPTH_REJ){
                        histSample = PrevHist.Load(int3(pi2,0));
                        if(histSample.a > 0.0f) reuse=true;
                    }
                }
            }
        }
    }
    if(reuse){
        o.color.rgb = cur.rgb*(1.0f-TAA_BLEND) + histSample.rgb*TAA_BLEND;
        o.color.a   = cur.a*(1.0f-TAA_BLEND) + histSample.a*TAA_BLEND;
        o.meta = float4(1.0f, 0.0f, 0.0f, 0.0f);
    } else {
        // First frame / disocclusion / object off-screen: take current sample,
        // which is pure sky for fallback pixels (never a stale image).
        o.color = cur;
        o.meta = float4(0.0f, 1.0f, 0.0f, 0.0f);
    }
    return o;
}
