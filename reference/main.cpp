// SSR reference simulator.
// Reproduces the D3D12 pipeline's screen-space reflection behavior on the CPU
// and emits validation artifacts:
//   - beauty / confidence / fallback-mask / geometric-overlay PNGs per frame
//   - per-pixel transition curves (valid screen hit -> environment fallback)
//   - hit statistics and geometric-reference intersection comparison (CSV)
//
// Build: g++ -std=c++17 -O2 main.cpp -o ssr_ref
// Run:   ./ssr_ref [width height frames]
#include "ssr_scene.hpp"
#include "ssr_gbuffer.hpp"
#include "ssr_trace.hpp"
#include "ssr_temporal.hpp"
#include "ssr_camera.hpp"
#include "ssr_image.hpp"
#include "ssr_artifacts.hpp"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <sys/stat.h>

int main(int argc,char**argv){
    int W=argc>1?std::atoi(argv[1]):320;
    int H=argc>2?std::atoi(argv[2]):180;
    int frames=argc>3?std::atoi(argv[3]):10;
    const float ZN=0.1f, ZF=40.0f, FOV=60.0f*3.14159265f/180.0f;
    float aspect=(float)W/H, tanY=std::tan(FOV*0.5f);

    Scene scene=Scene::make();
    std::vector<Mesh> meshes;
    meshes.push_back(makeGround());
    meshes.push_back(makeSphere(scene.spheres[0].center,scene.spheres[0].radius,scene.spheres[0].albedo));
    meshes.push_back(makeSphere(scene.spheres[1].center,scene.spheres[1].radius,scene.spheres[1].albedo));
    meshes.push_back(makeSphere(scene.spheres[2].center,scene.spheres[2].radius,scene.spheres[2].albedo));
    meshes.push_back(makeBox(scene.boxes[0].center,scene.boxes[0].halfExtent,scene.boxes[0].albedo));
    meshes.push_back(makeBox(scene.boxes[1].center,scene.boxes[1].halfExtent,scene.boxes[1].albedo));

    SSRConfig scfg; TemporalConfig tcfg;
    CameraPath paths[2]={pathOrbit(),pathDolly()};

    mkdir("artifacts_data",0755);
    std::ofstream stats("artifacts_data/hit_stats.csv");
    stats<<"path,frame,ground_px,ssr_hit,ssr_miss,geo_hit,geo_visible,agree_hit,agree_miss,mean_conf,stale_guard_triggers\n";
    std::ofstream curves("artifacts_data/transition_curves.csv");
    curves<<"path,pixel,frame,state,confidence,hit_u,hit_v,reason\n";

    for(int pi=0; pi<2; ++pi){
        TemporalBuffer hist, prevHist;
        std::vector<GBuffer> gbuf(2);
        std::vector<mat4> prevVP(2);
        // Tracked pixels: one near-mirror pixel whose reflected object exits
        // the screen during each path. Chosen automatically below at frame 0.
        std::vector<int> trackX, trackY;
        std::vector<float3> anchorWorld;
        int staleGuardTotal=0;

        for(int f=0; f<frames; ++f){
            int slot=f&1, prev=slot^1;
            CameraKey ck=paths[pi].sample((float)f/(frames-1));
            mat4 view=lookAt(ck.eye,ck.target,{0,1,0});
            mat4 proj=perspectiveD3D(FOV,aspect,ZN,ZF);
            mat4 vp=mulM(proj,view);
            GBuffer& gb=gbuf[slot];
            gb.init(W,H);
            rasterize(gb,meshes,view,proj);
            buildHiZ(gb);
            ViewProj vpq{view,proj,identity(),ZN,ZF,tanY,aspect,ck.eye};

            FrameOutputsLike out;
            size_t n=(size_t)W*H;
            out.results.assign(n,SSRResult{});
            out.ssrColor.assign(n,float3{0,0,0});
            out.fallback.assign(n,float3{0,0,0});
            out.geoRefl.assign(n,float3{0,0,0});
            out.geoVisible.assign(n,0);

            int groundPx=0, hitCount=0, geoCount=0, geoVis=0, agreeH=0, agreeM=0;
            float confSum=0;
            for(int y=0;y<H;++y) for(int x=0;x<W;++x){
                int idx=gb.idx(x,y);
                if(!gb.isGround[idx]) continue;
                groundPx++;
                // Geometric reference: reflect view ray about ground normal.
                float3 wp=gb.worldPos[idx], wn=gb.worldNormal[idx];
                float3 camDir=normalize(wp-ck.eye);
                float3 rdir=normalize(camDir-2.0f*dot(camDir,wn)*wn);
                float3 ro=wp+wn*0.002f;
                HitInfo gh=traceObjects(scene,ro,rdir);
                if(gh.hit){
                    geoCount++;
                    float3 sp=transformPoint(vp,gh.position);
                    // Screen-visibility test: the reflected point projects
                    // inside the viewport. The G-buffer stores front faces
                    // only, while a floor mirror sees object undersides, so we
                    // deliberately do not require the point itself to pass the
                    // hardware depth test here.
                    if(sp.x>-1&&sp.x<1&&sp.y>-1&&sp.y<1&&sp.z>0.0f&&sp.z<1.0f){
                        geoVis++; out.geoVisible[idx]=1;
                    }
                    out.geoRefl[idx]=shadeScene(scene,gh.position,gh.normal,gh.albedo);
                } else {
                    out.geoRefl[idx]=sampleSky(rdir);
                }
                // Stable environment fallback color (always available).
                out.fallback[idx]=sampleSky(rdir);

                SSRResult r=traceSSR(gb,vpq,x,y,scfg,false,nullptr);
                out.results[idx]=r;
                if(r.hit){
                    hitCount++; confSum+=r.confidence;
                    int hx=std::clamp((int)(r.hitUV.x*W),0,W-1);
                    int hy=std::clamp((int)(r.hitUV.y*H),0,H-1);
                    float3 ld=normalize(float3{-0.45f,0.80f,-0.35f});
                    float3 bn=gb.worldNormal[gb.idx(hx,hy)];
                    out.ssrColor[idx]=gb.albedo[gb.idx(hx,hy)]*(saturate(dot(bn,ld))*0.75f+0.25f);
                } else {
                    out.ssrColor[idx]=out.fallback[idx];
                }
                if(gh.hit){ if(r.hit)agreeH++; } else { if(!r.hit)agreeM++; }
            }

            if(f==0){
                // Select several floor anchors whose geometric reflection is
                // visible in the first frame; spread them across the viewport.
                for(int y=H/4;y<H*3/4 && (int)trackX.size()<3;y+=2)
                    for(int x=W/5;x<W*4/5 && (int)trackX.size()<3;x+=2){
                        int idx=gb.idx(x,y);
                        if(gb.isGround[idx] && out.geoVisible[idx]){
                            trackX.push_back(x); trackY.push_back(y);
                            anchorWorld.push_back(gb.worldPos[idx]);
                            y+=(H/6); // spatial separation between anchors
                            break;
                        }
                    }
                while((int)trackX.size()<3){
                    int fx=W/2, fy=H*3/4;
                    trackX.push_back(fx); trackY.push_back(fy);
                    anchorWorld.push_back(gb.worldPos[gb.idx(fx,fy)]);
                }
            } else {
                // Re-project each fixed world-space anchor per frame.
                for(size_t a=0;a<anchorWorld.size();++a){
                    float3 sp=transformPoint(vp,anchorWorld[a]);
                    trackX[a]=std::clamp((int)((sp.x*0.5f+0.5f)*W),0,W-1);
                    trackY[a]=std::clamp((int)((0.5f-sp.y*0.5f)*H),0,H-1);
                }
            }

            // Temporal accumulation with history invalidation.
            const GBuffer* pgb = f>0 ? &gbuf[prev] : nullptr;
            mat4 prevVPm = f>0 ? prevVP[prev] : identity();
            TemporalBuffer histSnapshot=hist;
            int beforeMiss=0;
            accumulateFrame(hist,histSnapshot,gb,pgb,vp,prevVPm,out.results,
                            out.ssrColor,out.fallback,tcfg);
            for(int y=0;y<H;++y) for(int x=0;x<W;++x){
                int idx=gb.idx(x,y);
                if(gb.isGround[idx] && !out.results[idx].hit &&
                   histSnapshot.valid.size()==n && histSnapshot.valid[idx] &&
                   histSnapshot.confidence[idx]>0.25f && hist.confidence[idx]<=0.0f) beforeMiss++;
            }
            staleGuardTotal+=beforeMiss;

            // Record each anchor's hit->fallback transition curve. The anchor
            // is re-traced explicitly so occluded / off-screen frames carry a
            // precise reason even though the main scan skips non-ground pixels.
            static const char* reasonName[]={"none","hit","offscreen","maxdist","steps","backface","occluded"};
            for(size_t a=0;a<trackX.size();++a){
                SSRResult tr=traceSSR(gb,vpq,trackX[a],trackY[a],scfg,false,nullptr);
                const char* rname = reasonName[std::clamp(tr.reason,0,6)];
                curves<<paths[pi].name<<",a"<<a<<"_"<<trackX[a]<<"x"<<trackY[a]<<","<<f<<","
                       <<(tr.hit?"hit":"fallback")<<","<<(tr.hit?tr.confidence:0.0f)<<","
                       <<(tr.hit?tr.hitUV.x:-1.0f)<<","<<(tr.hit?tr.hitUV.y:-1.0f)<<","
                       <<tr.reason<<"_"<<rname<<"\n";
            }

            stats<<paths[pi].name<<","<<f<<","<<groundPx<<","<<hitCount<<","
                 <<(groundPx-hitCount)<<","<<geoCount<<","<<geoVis<<","
                 <<agreeH<<","<<agreeM<<","
                 <<(hitCount?confSum/hitCount:0.0f)<<","<<beforeMiss<<"\n";

            prevVP[slot]=vp;
            renderFrameArtifacts(paths[pi].name,f,W,H,gb,out,hist,scene,vpq,scfg,ck,
                                 trackX.empty()?0:trackX[0], trackY.empty()?0:trackY[0]);
        }
        std::printf("path=%s anchors=%zu staleGuards=%d\n",
                    paths[pi].name.c_str(),trackX.size(),staleGuardTotal);
    }
    stats.close(); curves.close();
    return 0;
}
