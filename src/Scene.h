// CPU scene description matching reference/ssr_scene.hpp and the mesh upload
// performed by the D3D12 renderer.
#pragma once
#include <DirectXMath.h>
#include <vector>
#include <cstdint>

constexpr uint32_t GFLAG_GROUND = 1u;

struct Vertex {
    DirectX::XMFLOAT3 pos;
    DirectX::XMFLOAT3 normal;
    DirectX::XMFLOAT3 albedo;
    uint32_t flags;
};
struct MeshData {
    std::vector<Vertex> verts;
    std::vector<uint32_t> indices;
};

inline void AddQuad(std::vector<Vertex>& v, std::vector<uint32_t>& idx,
                    DirectX::XMFLOAT3 a, DirectX::XMFLOAT3 b,
                    DirectX::XMFLOAT3 c, DirectX::XMFLOAT3 d,
                    DirectX::XMFLOAT3 n, DirectX::XMFLOAT3 alb, uint32_t flags){
    uint32_t base=(uint32_t)v.size();
    for(auto p:{a,b,c,d}) v.push_back({p,n,alb,flags});
    idx.insert(idx.end(),{base,base+2,base+1, base+1,base+2,base+3});
}

inline MeshData BuildScene(){
    using namespace DirectX;
    MeshData m;
    // Ground mirror: 12x12 tessellated plane at y=0.
    const int seg=24; const float size=12.0f, h=size*0.5f;
    XMFLOAT3 groundAlb{0.55f,0.60f,0.66f};
    for(int z=0;z<=seg;++z) for(int x=0;x<=seg;++x){
        m.verts.push_back({{-h+size*x/seg,0.0f,-h+size*z/seg},{0,1,0},groundAlb,GFLAG_GROUND});
    }
    auto gid=[&](int x,int z){return z*(seg+1)+x;};
    for(int z=0;z<seg;++z) for(int x=0;x<seg;++x){
        uint32_t a=gid(x,z),b=gid(x+1,z),c=gid(x,z+1),d=gid(x+1,z+1);
        m.indices.insert(m.indices.end(),{a,c,b,b,c,d});
    }
    // Spheres and boxes (same transforms/colors as the reference scene).
    struct S{ XMFLOAT3 c; float r; XMFLOAT3 alb; };
    S spheres[]={
        {{-2.2f,1.0f,1.5f},1.0f,{0.90f,0.25f,0.20f}},
        {{ 0.6f,0.7f,3.2f},0.7f,{0.25f,0.75f,0.35f}},
        {{ 2.4f,1.4f,0.8f},1.4f,{0.30f,0.45f,0.95f}},
    };
    for(auto& sp: spheres){
        int lat=16, lon=24, base=(int)m.verts.size();
        for(int i=0;i<=lat;++i){
            float th=3.14159265f*i/lat;
            for(int j=0;j<=lon;++j){
                float ph=2.0f*3.14159265f*j/lon;
                XMFLOAT3 n{sinf(th)*cosf(ph),cosf(th),sinf(th)*sinf(ph)};
                m.verts.push_back({{sp.c.x+n.x*sp.r,sp.c.y+n.y*sp.r,sp.c.z+n.z*sp.r},n,sp.alb,0});
            }
        }
        auto id=[&](int i,int j){return base+i*(lon+1)+j;};
        for(int i=0;i<lat;++i) for(int j=0;j<lon;++j){
            uint32_t a=id(i,j),b=id(i+1,j),c=id(i,j+1),d=id(i+1,j+1);
            m.indices.insert(m.indices.end(),{a,b,c,c,b,d});
        }
    }
    struct B{ XMFLOAT3 c, half; XMFLOAT3 alb; };
    B boxes[]={
        {{-0.4f,0.5f,-1.4f},{0.5f,0.5f,0.5f},{0.95f,0.75f,0.25f}},
        {{ 1.8f,0.9f,-2.6f},{0.9f,0.9f,0.9f},{0.75f,0.35f,0.85f}},
    };
    static const XMFLOAT3 N[6]={{0,0,1},{0,0,-1},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0}};
    for(auto& bx:boxes){
        for(int f=0;f<6;++f){
            XMVECTOR n=XMLoadFloat3(&N[f]);
            XMVECTOR up=(f==4||f==5)?XMVectorSet(1,0,0,0):XMVectorSet(0,1,0,0);
            XMVECTOR t=XMVector3Normalize(XMVector3Cross(n,up));
            XMVECTOR bv=XMVector3Cross(t,n);
            XMVECTOR center=XMLoadFloat3(&bx.c);
            XMVECTOR hx=XMLoadFloat3(&bx.half);
            XMFLOAT3 corners[4];
            XMVECTOR signs[4]={XMVectorSet(-1,-1,0,0),XMVectorSet(1,-1,0,0),
                               XMVECTORSet(-1,1,0,0),XMVectorSet(1,1,0,0)};
            for(int k=0;k<4;++k){
                XMVECTOR p=center+n*XMVectorGetZ(hx)
                    +t*XMVectorGetX(signs[k])*XMVectorGetX(hx)
                    +bv*XMVectorGetY(signs[k])*XMVectorGetY(hx);
                XMStoreFloat3(&corners[k],p);
            }
            AddQuad(m.verts,m.indices,corners[0],corners[1],corners[2],corners[3],N[f],bx.alb,0);
        }
    }
    return m;
}
