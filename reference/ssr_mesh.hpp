// CPU-side triangle meshes for the software rasterizer. Mirrors the vertex
// layout produced by src/MeshUploader.* on the D3D12 side.
#pragma once
#include "ssr_math.hpp"
#include <vector>

struct Mesh {
    std::vector<float3> positions;
    std::vector<float3> normals;
    std::vector<uint32_t> indices;
    float3 albedo{1,1,1};
    bool ground{false};
};

inline Mesh makeGround(float size=12.0f, int seg=24){
    Mesh m; m.ground=true; m.albedo={0.55f,0.60f,0.66f};
    float h=size*0.5f;
    for(int z=0;z<=seg;++z) for(int x=0;x<=seg;++x){
        float px=-h+size*x/seg, pz=-h+size*z/seg;
        m.positions.push_back({px,0.0f,pz});
        m.normals.push_back({0,1,0});
    }
    auto id=[&](int x,int z){ return z*(seg+1)+x; };
    for(int z=0;z<seg;++z) for(int x=0;x<seg;++x){
        uint32_t a=id(x,z),b=id(x+1,z),c=id(x,z+1),d=id(x+1,z+1);
        m.indices.insert(m.indices.end(),{a,c,b, b,c,d});
    }
    return m;
}
inline Mesh makeSphere(float3 center, float r, float3 color, int lat=16, int lon=24){
    Mesh m; m.albedo=color;
    for(int i=0;i<=lat;++i){
        float theta=3.14159265f*i/lat;
        for(int j=0;j<=lon;++j){
            float phi=2.0f*3.14159265f*j/lon;
            float3 n{std::sin(theta)*std::cos(phi),std::cos(theta),std::sin(theta)*std::sin(phi)};
            m.normals.push_back(n);
            m.positions.push_back(center+n*r);
        }
    }
    auto id=[&](int i,int j){ return i*(lon+1)+j; };
    for(int i=0;i<lat;++i) for(int j=0;j<lon;++j){
        uint32_t a=id(i,j),b=id(i+1,j),c=id(i,j+1),d=id(i+1,j+1);
        m.indices.insert(m.indices.end(),{a,b,c, c,b,d});
    }
    return m;
}
inline Mesh makeBox(float3 center, float3 half, float3 color){
    Mesh m; m.albedo=color;
    static const float3 N[6]={{0,0,1},{0,0,-1},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0}};
    static const float3 T[6]={{1,0,0},{1,0,0},{0,0,-1},{0,0,1},{1,0,0},{1,0,0}};
    for(int f=0;f<6;++f){
        float3 n=N[f], t=T[f], b=cross(n,t);
        uint32_t base=(uint32_t)m.positions.size();
        for(int cy=0;cy<=1;++cy) for(int cx=0;cx<=1;++cx){
            float3 p=center+n*half.z + t*((cx?1.0f:-1.0f)*half.x) + b*((cy?1.0f:-1.0f)*half.y);
            m.positions.push_back(p); m.normals.push_back(n);
        }
        m.indices.insert(m.indices.end(),{base,base+1,base+2, base+2,base+1,base+3});
    }
    return m;
}
