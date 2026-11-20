// Screen-space reflection core, matching reference/ssr_trace.hpp.
#ifndef SSR_CORE_HLSLI
#define SSR_CORE_HLSLI
#include "Common.hlsli"

struct SSRResult {
    bool   hit;
    float  confidence;
    float2 hitUV;
    float  hitDistance;
    int    steps;
    int    reason;          // 0 none,1 hit,2 offscreen,3 maxdist,4 steps,5 backface,6 occluded
};

// Linear-view-depth Hi-Z pyramid: level 0 is full res, each texel stores the
// conservative farthest depth of its footprint (+inf when fully empty).
Texture2D<float>  HiZTex       : register(t0);
Texture2D         GColorTex    : register(t1);  // unorm RGB albedo
Texture2D<float>  GLinDepthTex : register(t2);
Texture2D<float3> GNormalTex   : register(t3);  // view normals
Texture2D<float3> GWorldNTex   : register(t4);  // world normals
Texture2D<float3> GWorldPosTex : register(t5);
Texture2D<uint>   GFlagsTex    : register(t6);
SamplerState      PointClamp   : register(s0);

float3 ViewToScreen(CameraCB cb, float3 p, out float ndcZ){
    float4 c = mul(cb.proj, float4(p, 1.0f));
    float iw = 1.0f / c.w;
    ndcZ = c.z * iw;
    return float3((c.x*iw*0.5f + 0.5f), (1.0f - (c.y*iw*0.5f + 0.5f)), ndcZ);
}

float ScreenConfidence(int W, int H, float2 uv, float3 viewNormal){
    if(uv.x<0 || uv.y<0 || uv.x>1 || uv.y>1) return 0.0f;
    float bx = min(uv.x, 1.0f-uv.x);
    float by = min(uv.y, 1.0f-uv.y);
    float edge = saturate(min(bx, by) / SSR_EDGE_FADE);
    float facing = saturate(-viewNormal.z*1.5f + 0.5f);
    return edge * facing;
}

SSRResult TraceSSR(CameraCB cb, int2 dims, int x, int y,
                   bool recordCurve, out float3 firstBounceWorld){
    SSRResult R = (SSRResult)0;
    firstBounceWorld = 0.0f;
    uint flags = GFlagsTex.Load(int3(x, y, 0));
    float startDepth = HiZTex.Load(int3(x, y, 0));
    if(!isfinite(startDepth)) { R.reason = 0; return R; }
    if((flags & GFLAG_GROUND) == 0u){ R.reason = 6; return R; }

    float3 worldPos = GWorldPosTex.Load(int3(x, y, 0));
    float3 worldN   = GWorldNTex.Load(int3(x, y, 0));
    float3 viewN    = GNormalTex.Load(int3(x, y, 0));
    float3 viewPos;
    {
        float4 vp4 = mul(cb.view, float4(worldPos, 1.0f));
        viewPos = vp4.xyz;
    }
    float3 worldView = normalize(worldPos - cb.cameraEye.xyz);
    float3 worldRefl = normalize(worldView - 2.0f*dot(worldView, worldN)*worldN);
    float3 rd = normalize(mul((float3x3)cb.view, worldRefl));
    firstBounceWorld = worldRefl;

    float ndc0, ndc1;
    float3 start = ViewToScreen(cb, viewPos, ndc0) * float3(dims, 1);
    float3 endP  = ViewToScreen(cb, viewPos + rd*SSR_MAX_DIST, ndc1) * float3(dims, 1);
    float2 delta = endP.xy - start.xy;
    float len2 = dot(delta, delta);
    if(len2 < 1e-6f){ R.reason = 2; return R; }

    int2 sx = clamp(int2(start.xy), int2(0,0), dims-1);
    int2 stepDir = (delta >= 0.0f) ? 1 : -1;
    float tX = delta.x!=0 ? ((stepDir.x>0 ? sx.x+1-start.x : start.x-sx.x)/abs(delta.x)) : 1e30f;
    float tY = delta.y!=0 ? ((stepDir.y>0 ? sx.y+1-start.y : start.y-sx.y)/abs(delta.y)) : 1e30f;
    float dtdx = delta.x!=0 ? 1.0f/abs(delta.x) : 1e30f;
    float dtdy = delta.y!=0 ? 1.0f/abs(delta.y) : 1e30f;
    float screenLen = sqrt(len2);
    float t = 0.0f; int2 c = sx;

    [loop]
    for(int step=0; step<SSR_MAX_STEPS; ++step){
        if(tX < tY){ t=tX; tX+=dtdx; c.x+=stepDir.x; }
        else       { t=tY; tY+=dtdy; c.y+=stepDir.y; }
        if(any(c<0) || any(c>=dims)){ R.reason=2; break; }
        if(t > 1.0f){ R.reason=3; break; }

        float3 rayView = viewPos + rd*(SSR_MAX_DIST*t);
        float linHere = GLinDepthTex.Load(int3(c,0));
        if(!isfinite(linHere)){
            // Hi-Z empty-footprint skip (provably empty region only).
            int level=0; float travelled=screenLen*t;
            while(level+1 < 8 && (float)(2<<level) <= travelled){ ++level; }
            int2 cc = c >> level;
            if(isfinite(HiZTex.Load(int3(cc, level)))) continue;
            continue;
        }
        uint cellFlags = GFlagsTex.Load(int3(c,0));
        if((cellFlags & GFLAG_GROUND) != 0u || SSR_MAX_DIST*t < 0.02f) continue;

        float depthDelta = rayView.z - linHere;
        if(depthDelta < -SSR_FRONT_EPS || depthDelta > SSR_THICKNESS) continue;

        float2 hitUV = (c + 0.5f) / float2(dims);
        float3 hitViewN = GNormalTex.Load(int3(c,0));
        float edgeC = ScreenConfidence(dims.x, dims.y, hitUV, hitViewN);
        if(edgeC <= 0.0f){ R.reason=5; break; }

        R.hit = true; R.hitUV = hitUV; R.hitDistance = SSR_MAX_DIST*t;
        R.steps = step+1; R.reason = 1;
        float thickC = 1.0f - saturate(depthDelta/SSR_THICKNESS);
        float distC  = 1.0f - saturate(R.hitDistance/SSR_MAX_DIST)*0.35f;
        R.confidence = saturate(edgeC*(0.55f + 0.45f*thickC)*distC);
        break;
    }
    if(!R.hit && R.reason==0) R.reason=4;
    return R;
}
#endif
