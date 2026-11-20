// Temporal accumulation for SSR, with explicit history invalidation.
// A history sample is only reused when:
//   1. it lands inside the current frame,
//   2. the reprojected pixel is still a reflective ground pixel,
//   3. its depth still matches the reprojected surface (disocclusion test),
//   4. the current screen-hit confidence did not collapse to fallback.
// When a reflected object leaves the screen, condition 2/3 fails and that
// pixel drops straight to the environment fallback instead of showing the
// previous frame's image.
#pragma once
#include "ssr_trace.hpp"
#include "ssr_scene.hpp"

struct TemporalBuffer {
    std::vector<float3> color;
    std::vector<float>  confidence;
    std::vector<float2> hitUV;
    std::vector<float>  linDepth;
    std::vector<uint8_t> valid;
    void resize(size_t n){
        color.assign(n,{0,0,0}); confidence.assign(n,0.0f);
        hitUV.assign(n,{0,0}); linDepth.assign(n,0.0f); valid.assign(n,0);
    }
};

struct TemporalConfig {
    float blend = 0.85f;          // history weight on stable pixels
    float depthReject = 0.25f;     // world-unit disocclusion threshold
};

inline float3 resolveSSR(const GBuffer& gb, const SSRResult& r,
                         const Scene& scene){
    (void)scene;
    if(!r.hit){
        // Stable fallback: deterministic procedural sky, never history.
        int pi = 0; (void)pi;
        return float3{0,0,0}; // filled by caller with reflected ray sky sample
    }
    int px=std::clamp((int)(r.hitUV.x*gb.W),0,gb.W-1);
    int py=std::clamp((int)(r.hitUV.y*gb.H),0,gb.H-1);
    int si=gb.idx(px,py);
    float3 base = gb.albedo[si];
    // Simple shading of reflected sample.
    float3 ld=normalize(float3{-0.45f,0.80f,-0.35f});
    float lit=saturate(dot(gb.worldNormal[si],ld))*0.7f+0.3f;
    return base*lit;
}

inline void accumulateFrame(
    TemporalBuffer& hist, const TemporalBuffer& prevHist,
    const GBuffer& curGB, const GBuffer* prevGB,
    const mat4& curViewProj, const mat4& prevViewProj,
    const std::vector<SSRResult>& results,
    const std::vector<float3>& currentSSRColor,
    const std::vector<float3>& fallbackColor,
    const TemporalConfig& tcfg)
{
    size_t n=(size_t)curGB.W*curGB.H;
    (void)curViewProj;
    hist.resize(n);
    for(size_t i=0;i<n;++i){
        SSRResult r=results[i];
        float3 cur = r.hit ? currentSSRColor[i] : fallbackColor[i];
        float curConf = r.hit ? r.confidence : 0.0f;

        bool reuse=false;
        // Hard rule: a pixel without a valid current screen hit must never
        // inherit history. When the reflected object leaves the screen (or the
        // pixel becomes occluded / reaches max distance) this forces the color
        // to the deterministic environment fallback in a single frame, so no
        // previous-frame image can linger on the floor mirror.
        if(r.hit && prevGB && prevHist.valid.size()==n && prevHist.valid[i]){
            // Reproject current world position into previous frame.
            float4 h = mul(prevViewProj,{curGB.worldPos[i].x,curGB.worldPos[i].y,
                                         curGB.worldPos[i].z,1.0f});
            if(h.w>0.0f){
                float u=h.x/h.w*0.5f+0.5f, v=h.y/h.w*0.5f+0.5f;
                if(u>=0&&v>=0&&u<1&&v<1 && curGB.isGround[i]){
                    int px=std::clamp((int)(u*prevGB->W),0,prevGB->W-1);
                    int py=std::clamp((int)((1.0f-v)*prevGB->H),0,prevGB->H-1);
                    int pj=prevGB->idx(px,py);
                    if(prevGB->isGround[pj] && prevHist.valid[pj] &&
                       prevHist.confidence[pj] > 0.0f){
                        float dz=std::fabs(prevGB->linDepth[pj]-curGB.linDepth[i]);
                        if(dz < tcfg.depthReject){
                            float w=tcfg.blend;
                            hist.color[i] = cur*(1.0f-w)+prevHist.color[pj]*w;
                            hist.confidence[i] = curConf*(1.0f-w)+prevHist.confidence[pj]*w;
                            hist.hitUV[i]=r.hit?r.hitUV:prevHist.hitUV[pj];
                            hist.linDepth[i]=curGB.linDepth[i];
                            hist.valid[i]=1;
                            reuse=true;
                        }
                    }
                }
            }
        }
        if(!reuse){
            // No valid history (first frame / disocclusion / object off-screen):
            // take current sample directly. Fallback pixels get pure sky.
            hist.color[i]=cur;
            hist.confidence[i]=curConf;
            hist.hitUV[i]=r.hit?r.hitUV:float2{-1,-1};
            hist.linDepth[i]=curGB.linDepth[i];
            hist.valid[i]=1;
        }
    }
}
