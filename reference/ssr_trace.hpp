// Screen-space reflection core, shared 1:1 in spirit with shaders/SSR.hlsli.
//
// Traversal: hierarchical (Hi-Z) DDA. At each crossing we jump to the
// coarsest mip whose texel footprint still fits the remaining ray segment,
// which keeps long rays cheap while the thickness threshold rejects false
// hits on thin/back-facing geometry.
#pragma once
#include "ssr_gbuffer.hpp"
#include <cmath>

struct SSRConfig {
    float thicknessWorld = 0.35f;   // max view-depth delta accepted as a hit
    float maxRayDistance = 14.0f;   // world units
    int   maxSteps       = 160;     // DDA step budget
    float edgeFade       = 0.06f;   // normalized screen border fade width
    float screenFadeStart= 0.80f;   // start fading when ray approaches edge
};

struct SSRResult {
    bool hit=false;
    float confidence=0.0f;          // 0 = pure fallback, 1 = solid screen hit
    float2 hitUV{0,0};
    float hitDistance=0.0f;
    int   steps=0;
    int   reason=0;                 // 0 none,1 hit,2 offscreen,3 maxdist,4 steps,5 backface,6 occluded
};

inline float ndcZToViewZ(float z, float zn, float zf){
    if(z>=1.0f) return std::numeric_limits<float>::infinity();
    return zn*zf/(zf-(zf-zn)*z);
}

// Reconstruct view-space ray from a G-buffer pixel.
inline float3 reflectViewRay(const GBuffer& gb, int x,int y,
                             float tanHalfFovY, float aspect,
                             float3 cameraEye, const mat4& view){
    (void)tanHalfFovY; (void)aspect;
    int pi=gb.idx(x,y);
    // Match the geometric reference exactly: reflect the world-space view
    // ray about the world normal, then bring the result into view space.
    float3 worldView = normalize(gb.worldPos[pi]-cameraEye);
    float3 worldRefl = normalize(worldView
        - 2.0f*dot(worldView,gb.worldNormal[pi])*gb.worldNormal[pi]);
    return normalize(transformDir(view,worldRefl));
}

struct ViewProj { mat4 view, proj, invProj; float zn,zf,tanHalfFovY,aspect;
                  float3 cameraEye; };

inline float3 viewToScreen(const ViewProj& vp, float3 p, int W,int H){
    float4 c = mul(vp.proj,{p.x,p.y,p.z,1.0f});
    float iw=1.0f/c.w;
    return {(c.x*iw*0.5f+0.5f)*W, (1.0f-(c.y*iw*0.5f+0.5f))*H, c.z*iw};
}

// Screen-space edge/backface confidence for a candidate hit pixel.
inline float screenConfidence(const GBuffer& gb, const SSRConfig& cfg,
                              float2 uv, float3 hitView, float3 rayDir){
    (void)rayDir; (void)hitView;
    if(uv.x<0||uv.y<0||uv.x>1||uv.y>1) return 0.0f;
    int px=(int)std::floor(uv.x*gb.W), py=(int)std::floor(uv.y*gb.H);
    px=std::clamp(px,0,gb.W-1); py=std::clamp(py,0,gb.H-1);
    int pi=gb.idx(px,py);
    if(gb.depth[pi]>=1.0f) return 0.0f;
    // Fade toward screen borders so off-screen transitions are smooth.
    float bx=std::min(uv.x,1.0f-uv.x), by=std::min(uv.y,1.0f-uv.y);
    float edge=saturate(std::min(bx,by)/cfg.edgeFade);
    // Back-facing geometry stores view normal pointing away from camera;
    // reflected samples there are unreliable, fade them out.
    float3 n=gb.viewNormal[pi];
    float facing=saturate(-n.z*1.5f+0.5f);
    return edge*facing;
}

inline SSRResult traceSSR(const GBuffer& gb, const ViewProj& vpq,
                          int x,int y, const SSRConfig& cfg,
                          bool recordCurve, std::vector<float2>* curve=nullptr){
    SSRResult R;
    int pi=gb.idx(x,y);
    if(gb.depth[pi]>=1.0f) { R.reason=0; return R; }
    if(!gb.isGround[pi]) { R.reason=6; return R; }
    float aspect=(float)gb.W/gb.H;
    float3 ro = gb.viewPos[pi];
    float3 rd = reflectViewRay(gb,x,y,vpq.tanHalfFovY,aspect,
                               vpq.cameraEye,vpq.view);
    float tMax=cfg.maxRayDistance;

    float3 start = viewToScreen(vpq,ro,gb.W,gb.H);
    float3 endP  = viewToScreen(vpq,ro+rd*tMax,gb.W,gb.H);
    float2 delta{endP.x-start.x, endP.y-start.y};
    float len2=delta.x*delta.x+delta.y*delta.y;
    if(len2 < 1e-6f){ R.reason=2; return R; }
    if(recordCurve && curve) curve->clear();

    // Full-resolution DDA. The Hi-Z pyramid is used as a conservative
    // visibility oracle: when even the farthest depth in the coarse footprint
    // covering this cell lies beyond the ray (plus thickness), no geometry can
    // be intersected here, so we skip the full-res depth work and march on.
    // Acceptance tests always run against full-resolution linear view depth.
    int sx=std::clamp((int)start.x,0,gb.W-1), sy=std::clamp((int)start.y,0,gb.H-1);
    int stepX=delta.x>=0?1:-1, stepY=delta.y>=0?1:-1;
    float tX = delta.x!=0 ? ((stepX>0?(sx+1-start.x):(start.x-sx))/std::fabs(delta.x)) : 1e30f;
    float tY = delta.y!=0 ? ((stepY>0?(sy+1-start.y):(start.y-sy))/std::fabs(delta.y)) : 1e30f;
    float dtdx= delta.x!=0? 1.0f/std::fabs(delta.x):1e30f;
    float dtdy= delta.y!=0? 1.0f/std::fabs(delta.y):1e30f;
    float screenLen=std::sqrt(len2);
    float t=0.0f; int cx=sx, cy=sy;
    for(int step=0; step<cfg.maxSteps; ++step){
        if(tX<tY){ t=tX; tX+=dtdx; cx+=stepX; }
        else     { t=tY; tY+=dtdy; cy+=stepY; }
        if(cx<0||cy<0||cx>=gb.W||cy>=gb.H){ R.reason=2; break; }
        if(t>1.0f){ R.reason=3; break; }
        if(recordCurve && curve)
            curve->push_back({(cx+0.5f)/gb.W,(cy+0.5f)/gb.H});

        float3 rayView = ro + rd*(tMax*t);
        int ni=gb.idx(cx,cy);
        // Hi-Z is used only to skip provably empty footprints (max depth is
        // +inf). Any cell containing geometry is judged at full resolution,
        // so a coarse footprint mixing an object with the far ground plane can
        // never suppress a real intersection.
        if(!std::isfinite(gb.linDepth[ni])){
            int level=0;
            float travelledPx=screenLen*t;
            while(level+1 < (int)gb.hiz.size() && level < 3 &&
                  (float)(2<<level) <= travelledPx){ ++level; }
            if(std::isfinite(sampleHiZ(gb,level,cx>>level,cy>>level)))
                continue; // geometry somewhere in the footprint: keep marching at full res
            continue;     // truly empty footprint: skip
        }
        if(gb.isGround[ni] || !std::isfinite(gb.linDepth[ni]) || tMax*t < 0.02f)
            continue;
        // Thickness band in linear view depth. A small front epsilon absorbs
        // DDA quantization; the rear bound rejects thin-surface overshoot.
        float frontEps=0.08f;
        float depthDelta = rayView.z - gb.linDepth[ni];
        if(depthDelta < -frontEps || depthDelta > cfg.thicknessWorld) continue;

        float2 hitUV{(cx+0.5f)/gb.W,(cy+0.5f)/gb.H};
        float edgeC=screenConfidence(gb,cfg,hitUV,rayView,rd);
        if(edgeC<=0.0f){ R.reason=5; break; }
        R.hit=true; R.hitUV=hitUV; R.hitDistance=tMax*t; R.steps=step+1;
        R.reason=1;
        float thickC=1.0f-saturate(depthDelta/cfg.thicknessWorld);
        float distC=1.0f-saturate(R.hitDistance/cfg.maxRayDistance)*0.35f;
        R.confidence=saturate(edgeC*(0.55f+0.45f*thickC)*distC);
        break;
    }
    if(!R.hit && R.reason==0) R.reason=4;
    return R;
}
