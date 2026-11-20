// Unit test: when a reflected object leaves the screen, floor pixels must not
// retain the previous frame's bright reflection color. They must fall back to
// the deterministic environment (sky) within a single frame.
#include "ssr_gbuffer.hpp"
#include "ssr_mesh.hpp"
#include "ssr_trace.hpp"
#include "ssr_temporal.hpp"
#include "ssr_scene.hpp"
#include "ssr_camera.hpp"
#include <cstdio>
#include <cmath>

int main(){
    int W=200,H=120; const float ZN=0.1f,ZF=40.0f,FOV=60*3.14159265f/180.0f;
    float aspect=(float)W/H, tanY=std::tan(FOV/2);
    Scene scene=Scene::make();
    std::vector<Mesh> ms{makeGround()};
    for(auto&s:scene.spheres) ms.push_back(makeSphere(s.center,s.radius,s.albedo));
    for(auto&b:scene.boxes) ms.push_back(makeBox(b.center,b.halfExtent,b.albedo));
    SSRConfig scfg; TemporalConfig tcfg;

    // Frame A: camera frames the red sphere so its reflection is on screen.
    CameraKey A{{-3.0f,2.0f,5.0f},{0,0.5f,0}};
    // Frame B: swing far enough that the red sphere is fully off-screen.
    CameraKey B{{ 6.0f,2.5f,4.0f},{0,0.5f,0}};

    GBuffer gb[2]; TemporalBuffer hist, prevHist;
    mat4 prevVP;
    int failures=0;
    for(int frame=0; frame<2; ++frame){
        CameraKey ck = frame==0?A:B;
        mat4 view=lookAt(ck.eye,ck.target,{0,1,0});
        mat4 proj=perspectiveD3D(FOV,aspect,ZN,ZF);
        mat4 vp=mulM(proj,view);
        int slot=frame&1;
        gb[slot].init(W,H); rasterize(gb[slot],ms,view,proj); buildHiZ(gb[slot]);
        ViewProj vpq{view,proj,identity(),ZN,ZF,tanY,aspect,ck.eye};
        size_t n=(size_t)W*H;
        std::vector<SSRResult> res(n);
        std::vector<float3> cur(n), fb(n);
        for(int y=0;y<H;++y)for(int x=0;x<W;++x){
            int i=gb[slot].idx(x,y);
            float3 wp=gb[slot].worldPos[i], wn=gb[slot].worldNormal[i];
            float3 cd=normalize(wp-ck.eye), rd=normalize(cd-2*dot(cd,wn)*wn);
            fb[i]=sampleSky(rd);
            if(gb[slot].isGround[i]){
                res[i]=traceSSR(gb[slot],vpq,x,y,scfg,false,nullptr);
                cur[i]=res[i].hit ? gb[slot].albedo[i] : fb[i];
            } else { cur[i]=fb[i]; }
        }
        TemporalBuffer snap=hist;
        const GBuffer* pgb=frame==0?nullptr:&gb[slot^1];
        accumulateFrame(hist,snap,gb[slot],pgb,vp,frame==0?identity():prevVP,
                        res,cur,fb,tcfg);
        prevVP=vp;
        if(frame==1){
            // Every ground pixel that lost its screen hit must now match the
            // sky fallback closely (no bright, stale history carried over).
            for(size_t i=0;i<n;++i){
                if(gb[slot].isGround[i] && !res[i].hit){
                    float3 d=hist.color[i]-fb[i];
                    float e=std::sqrt(dot(d,d));
                    if(e > 0.02f){ if(failures<5) std::printf("STALE px=%zu err=%.4f\n",i,e); failures++; }
                }
            }
        }
    }
    if(failures==0){ std::printf("PASS: no stale reflection after object exits screen\n"); return 0; }
    std::printf("FAIL: %d stale pixels retained previous-frame image\n",failures);
    return 1;
}
