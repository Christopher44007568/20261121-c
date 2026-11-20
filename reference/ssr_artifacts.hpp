// Frame artifact rendering: beauty, confidence heat map, fallback mask,
// geometric-reference overlay, and the ray march curve for the tracked pixel.
#pragma once
#include "ssr_trace.hpp"
#include "ssr_temporal.hpp"
#include "ssr_image.hpp"
#include <sys/stat.h>
#include <cstdio>
#include <string>

struct FrameOutputsLike {
    std::vector<SSRResult> results;
    std::vector<float3> ssrColor;
    std::vector<float3> fallback;
    std::vector<float3> geoRefl;
    std::vector<uint8_t> geoVisible;
};

inline void ensureDir(const std::string& d){ mkdir(d.c_str(),0755); }

inline RGB heat(float t){
    t=saturate(t);
    float3 c;
    if(t<0.5f) c=float3{0.15f,0.30f,0.85f}*(1.0f-2*t)+float3{0.95f,0.85f,0.25f}*(2*t);
    else      c=float3{0.95f,0.85f,0.25f}*(2.0f-2*t)+float3{0.95f,0.20f,0.15f}*(2*t-1.0f);
    return toRGB(c);
}

inline void renderFrameArtifacts(const std::string& pathName,int f,int W,int H,
                                 const GBuffer& gb,
                                 const FrameOutputsLike& out,
                                 const TemporalBuffer& hist,
                                 const Scene& scene,
                                 const ViewProj& vpq,const SSRConfig& scfg,
                                 const CameraKey& ck,int trackX,int trackY){
    (void)ck;
    (void)scene;
    ensureDir("artifacts_data");
    std::string tag=pathName+"_f"+std::to_string(f);
    std::vector<RGB> beauty((size_t)W*H), conf((size_t)W*H), mask((size_t)W*H), geo((size_t)W*H);
    for(int y=0;y<H;++y) for(int x=0;x<W;++x){
        int i=gb.idx(x,y);
        if(gb.depth[i]>=1.0f){
            beauty[i]=toRGB(sampleSky(normalize(float3{(x/(float)W-0.5f),-(y/(float)H-0.5f),1.0f})));
            conf[i]={16,16,16}; mask[i]={16,16,16}; geo[i]=beauty[i];
            continue;
        }
        float3 base=shadeScene(scene,gb.worldPos[i],gb.worldNormal[i],gb.albedo[i]);
        if(gb.isGround[i]){
            // Composite: reflection tinted by floor, blended by confidence.
            float c=hist.confidence[i];
            float3 refl=hist.color[i];
            float3 floorCol=gb.albedo[i]*0.35f;
            beauty[i]=toRGB(floorCol*(1.0f-0.55f)+refl*0.55f);
            conf[i]=heat(c);
            bool fb=!out.results[i].hit;
            mask[i]=fb?RGB{220,60,60}:RGB{40,180,90};
            // Geometric overlay: green=SSR agrees with geometric visibility,
            // red=SSR missed a visible geometric hit, blue=correct fallback.
            bool gv=out.geoVisible[i]; bool sh=out.results[i].hit;
            if(gv&&sh) geo[i]=RGB{40,200,90};
            else if(gv&&!sh) geo[i]=RGB{220,50,50};
            else if(!gv&&!sh) geo[i]=RGB{60,110,220};
            else geo[i]=RGB{230,200,60};
        } else {
            beauty[i]=toRGB(base); conf[i]={30,30,30}; mask[i]={30,30,30}; geo[i]=toRGB(base);
        }
    }
    // Mark tracked pixel and draw its march curve on the confidence image.
    std::vector<float2> curve;
    SSRResult rr=traceSSR(gb,vpq,trackX,trackY,scfg,true,&curve);
    for(auto& uv:curve){
        int cx=std::clamp((int)(uv.x*W),0,W-1), cy=std::clamp((int)(uv.y*H),0,H-1);
        for(int dy=-1;dy<=1;++dy)for(int dx=-1;dx<=1;++dx){
            int xx=cx+dx,yy=cy+dy; if(xx<0||yy<0||xx>=W||yy>=H)continue;
            conf[gb.idx(xx,yy)]=RGB{255,255,255};
        }
    }
    for(int dy=-2;dy<=2;++dy)for(int dx=-2;dx<=2;++dx){
        int xx=trackX+dx,yy=trackY+dy; if(xx<0||yy<0||xx>=W||yy>=H)continue;
        beauty[gb.idx(xx,yy)]=RGB{255,255,0};
        conf[gb.idx(xx,yy)]=RGB{255,170,0};
    }
    if(rr.hit){
        int hx=(int)(rr.hitUV.x*W),hy=(int)(rr.hitUV.y*H);
        for(int dy=-2;dy<=2;++dy)for(int dx=-2;dx<=2;++dx){
            int xx=hx+dx,yy=hy+dy; if(xx<0||yy<0||xx>=W||yy>=H)continue;
            conf[gb.idx(xx,yy)]=RGB{0,255,255};
        }
    }
    writePNG("artifacts_data/"+tag+"_beauty.png",beauty,W,H);
    writePNG("artifacts_data/"+tag+"_confidence.png",conf,W,H);
    writePNG("artifacts_data/"+tag+"_fallback_mask.png",mask,W,H);
    writePNG("artifacts_data/"+tag+"_geo_overlay.png",geo,W,H);
}
