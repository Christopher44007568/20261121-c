// Full-screen SSR resolve: trace each ground pixel, shade the reflected
// sample, and output the raw current-frame SSR color plus a confidence map.
// Environment fallback (procedural sky) is always available and deterministic.
#include "Common.hlsli"
#include "SSR.hlsli"
ConstantBuffer<CameraCB> CB : register(b1);

struct Out {
    float4 ssrColor  : SV_Target0; // rgb current reflection, a confidence
    float4 debug     : SV_Target1; // rgb debug encoding, a reason
};

Out PSMain(float4 p:SV_POSITION){
    int2 dims; HiZTex.GetDimensions(dims.x, dims.y);
    int x=(int)p.x, y=(int)p.y;
    float3 bounceWorld;
    SSRResult r = TraceSSR(CB, dims, x, y, false, bounceWorld);
    Out o;
    uint flags = GFlagsTex.Load(int3(x,y,0));
    float3 fallback = SampleSky(bounceWorld);
    if(r.hit){
        int2 hx = clamp(int2(r.hitUV*float2(dims)), int2(0,0), dims-1);
        float3 alb = GColorTex.Load(int3(hx,0)).rgb;
        float3 wn  = GWorldNTex.Load(int3(hx,0));
        float3 ld = normalize(float3(-0.45f, 0.80f, -0.35f));
        float lit = saturate(dot(wn,ld))*0.75f + 0.25f;
        o.ssrColor = float4(alb*lit, r.confidence);
    } else {
        o.ssrColor = float4(fallback, 0.0f);
    }
    // Debug channels encode reason for the validation overlay.
    float3 dbg = float3(0,0,0);
    if((flags & GFLAG_GROUND)!=0u){
        if(r.hit) dbg = float3(0.05f, 0.8f, 0.2f);
        else if(r.reason==2) dbg = float3(0.9f,0.2f,0.1f);
        else if(r.reason==3 || r.reason==4) dbg = float3(0.2f,0.4f,0.9f);
        else dbg = float3(0.6f,0.5f,0.1f);
    }
    o.debug = float4(dbg, (float)r.reason);
    return o;
}
