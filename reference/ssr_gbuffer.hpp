// Software G-buffer rasterizer and Hi-Z pyramid generator.
// Depth convention mirrors D3D12: clip z/w in [0,1], larger = farther.
#pragma once
#include "ssr_math.hpp"
#include "ssr_mesh.hpp"
#include <vector>
#include <limits>

struct GBuffer {
    int W=0, H=0;
    std::vector<float> depth;      // NDC depth [0,1], 1.0 = empty
    std::vector<float> linDepth;   // view-space z, +inf if empty
    std::vector<float3> viewPos;
    std::vector<float3> viewNormal;
    std::vector<float3> worldPos;
    std::vector<float3> worldNormal;
    std::vector<float3> albedo;
    std::vector<uint8_t> isGround;
    // Hi-Z: level 0 is full res; each level stores the *farthest* depth of
    // its 2x2 footprint (conservative for ray traversal).
    std::vector<std::vector<float>> hiz;
    std::vector<int> hizW, hizH;

    void init(int w,int h){
        W=w;H=h;
        size_t n=(size_t)w*h;
        depth.assign(n,1.0f); linDepth.assign(n,std::numeric_limits<float>::infinity());
        viewPos.assign(n,{0,0,0}); viewNormal.assign(n,{0,0,0});
        worldPos.assign(n,{0,0,0}); worldNormal.assign(n,{0,0,0});
        albedo.assign(n,{0,0,0}); isGround.assign(n,0);
    }
    int idx(int x,int y) const { return y*W+x; }
};

inline void rasterize(GBuffer& gb, const std::vector<Mesh>& meshes,
                      const mat4& view, const mat4& proj){
    mat4 vp = mulM(proj,view);
    for(const Mesh& mesh : meshes){
        const auto& I=mesh.indices;
        for(size_t k=0;k<I.size();k+=3){
            float3 w[3]={mesh.positions[I[k]],mesh.positions[I[k+1]],mesh.positions[I[k+2]]};
            float3 n[3]={mesh.normals[I[k]],mesh.normals[I[k+1]],mesh.normals[I[k+2]]};
            float4 clip[3]; float2 screen[3]; float ndcZ[3]; float invW[3];
            bool behind=false;
            for(int i=0;i<3;++i){
                clip[i]=mul(vp,{w[i].x,w[i].y,w[i].z,1.0f});
                if(clip[i].w<=0.0f){ behind=true; break; }
                invW[i]=1.0f/clip[i].w;
                screen[i]={(clip[i].x*invW[i]*0.5f+0.5f)*gb.W,
                           (1.0f-(clip[i].y*invW[i]*0.5f+0.5f))*gb.H};
                ndcZ[i]=clip[i].z*invW[i];
            }
            if(behind) continue;
            float area=(screen[1].x-screen[0].x)*(screen[2].y-screen[0].y)
                      -(screen[2].x-screen[0].x)*(screen[1].y-screen[0].y);
            if(std::fabs(area)<1e-6f) continue;
            int minX=std::max(0,(int)std::floor(std::min({screen[0].x,screen[1].x,screen[2].x})));
            int maxX=std::min(gb.W-1,(int)std::ceil(std::max({screen[0].x,screen[1].x,screen[2].x})));
            int minY=std::max(0,(int)std::floor(std::min({screen[0].y,screen[1].y,screen[2].y})));
            int maxY=std::min(gb.H-1,(int)std::ceil(std::max({screen[0].y,screen[1].y,screen[2].y})));
            for(int py=minY;py<=maxY;++py) for(int px=minX;px<=maxX;++px){
                float sx=px+0.5f, sy=py+0.5f;
                float l0=((screen[1].x-sx)*(screen[2].y-sy)-(screen[2].x-sx)*(screen[1].y-sy))/area;
                float l1=((screen[2].x-sx)*(screen[0].y-sy)-(screen[0].x-sx)*(screen[2].y-sy))/area;
                float l2=1.0f-l0-l1;
                if(l0<0||l1<0||l2<0) continue;
                float z=l0*ndcZ[0]+l1*ndcZ[1]+l2*ndcZ[2];
                int pi=gb.idx(px,py);
                if(z>=gb.depth[pi]) continue;
                gb.depth[pi]=z;
                float3 wpos = w[0]*l0+w[1]*l1+w[2]*l2;
                float3 wn = normalize(n[0]*l0+n[1]*l1+n[2]*l2);
                float3 vp = transformPoint(view,wpos);
                float3 vn = normalize(transformDir(view,wn));
                gb.linDepth[pi]=vp.z;
                gb.viewPos[pi]=vp; gb.viewNormal[pi]=vn;
                gb.worldPos[pi]=wpos; gb.worldNormal[pi]=wn;
                gb.albedo[pi]=mesh.albedo; gb.isGround[pi]=mesh.ground?1:0;
            }
        }
    }
}

// Build conservative max-depth pyramid in *linear view depth*. Empty texels
// (infinite depth) are ignored unless the whole quad is empty, in which case
// the level stays +inf. Linear depth keeps far-field comparisons meaningful;
// NDC depth would compress 8..20 units into a 0.008 wide band.
inline void buildHiZ(GBuffer& gb){
    gb.hiz.clear(); gb.hizW.clear(); gb.hizH.clear();
    gb.hiz.push_back(gb.linDepth);
    gb.hizW.push_back(gb.W); gb.hizH.push_back(gb.H);
    int w=gb.W,h=gb.H;
    while(w>1 || h>1){
        int nw=std::max(1,w/2), nh=std::max(1,h/2);
        const auto& src=gb.hiz.back();
        std::vector<float> dst((size_t)nw*nh,1.0f);
        for(int y=0;y<nh;++y) for(int x=0;x<nw;++x){
            float farZ=0.0f; bool any=false;
            for(int dy=0;dy<2;++dy) for(int dx=0;dx<2;++dx){
                int sx=std::min(w-1,x*2+dx), sy=std::min(h-1,y*2+dy);
                float z=src[sy*w+sx];
                if(std::isfinite(z)){ any=true; farZ=std::max(farZ,z); }
            }
            dst[y*nw+x]=any?farZ:std::numeric_limits<float>::infinity();
        }
        gb.hiz.push_back(std::move(dst));
        gb.hizW.push_back(nw); gb.hizH.push_back(nh);
        w=nw; h=nh;
    }
}
inline float sampleHiZ(const GBuffer& gb, int level, int x,int y){
    int w=gb.hizW[level], h=gb.hizH[level];
    x=std::clamp(x,0,w-1); y=std::clamp(y,0,h-1);
    return gb.hiz[level][(size_t)y*w+x];
}
