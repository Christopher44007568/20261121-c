// Small scene shared by rasterizer and geometric reference:
//  - one ground plane acting as a floor mirror
//  - a few spheres / boxes as reflected objects
//  - a procedural sky used as the stable environment fallback
#pragma once
#include "ssr_math.hpp"
#include <vector>
#include <string>

struct Sphere { float3 center; float radius; float3 albedo; };
struct Box { float3 center; float3 halfExtent; float3 albedo; };

struct Scene {
    float3 groundPoint{0,0,0};
    float3 groundNormal{0,1,0};
    float3 groundTint{0.55f,0.60f,0.66f};
    std::vector<Sphere> spheres;
    std::vector<Box> boxes;

    static Scene make(){
        Scene s;
        s.spheres.push_back({{-2.2f,1.0f, 1.5f}, 1.0f, {0.90f,0.25f,0.20f}});
        s.spheres.push_back({{ 0.6f,0.7f, 3.2f}, 0.7f, {0.25f,0.75f,0.35f}});
        s.spheres.push_back({{ 2.4f,1.4f, 0.8f}, 1.4f, {0.30f,0.45f,0.95f}});
        s.boxes.push_back({{-0.4f,0.5f,-1.4f},{0.5f,0.5f,0.5f},{0.95f,0.75f,0.25f}});
        s.boxes.push_back({{ 1.8f,0.9f,-2.6f},{0.9f,0.9f,0.9f},{0.75f,0.35f,0.85f}});
        return s;
    }
};

struct HitInfo {
    bool hit{false};
    float t{1e30f};
    float3 position;
    float3 normal;
    float3 albedo;
    const char* object{""};
};

inline bool intersectPlane(float3 ro, float3 rd, float3 p, float3 n, float& t){
    float denom = dot(rd,n);
    if(std::fabs(denom) < 1e-6f) return false;
    t = dot(p-ro,n)/denom;
    return t > 0.0f;
}
inline bool intersectSphere(float3 ro, float3 rd, const Sphere& sp, HitInfo& h){
    float3 oc = ro-sp.center;
    float b = dot(oc,rd);
    float c = dot(oc,oc)-sp.radius*sp.radius;
    float disc = b*b-c;
    if(disc < 0.0f) return false;
    float t = -b-std::sqrt(disc);
    if(t <= 0.0f) return false;
    if(t >= h.t) return false;
    h.hit=true; h.t=t; h.position=ro+rd*t;
    h.normal=normalize(h.position-sp.center); h.albedo=sp.albedo; h.object="sphere";
    return true;
}
inline bool intersectBox(float3 ro, float3 rd, const Box& b, HitInfo& h){
    float3 lo = b.center-b.halfExtent, hi = b.center+b.halfExtent;
    float tmin=0.0f, tmax=1e30f;
    for(int ax=0; ax<3; ++ax){
        float o = (&ro.x)[ax], d = (&rd.x)[ax];
        float l = (&lo.x)[ax], u = (&hi.x)[ax];
        if(std::fabs(d)<1e-8f){ if(o<l||o>u) return false; }
        else {
            float t1=(l-o)/d, t2=(u-o)/d;
            if(t1>t2) std::swap(t1,t2);
            tmin=std::max(tmin,t1); tmax=std::min(tmax,t2);
            if(tmin>tmax) return false;
        }
    }
    if(tmin<=0.0f) return false;
    if(tmin>=h.t) return false;
    h.hit=true; h.t=tmin; h.position=ro+rd*tmin;
    float3 local = (h.position-b.center);
    float3 n{};
    float best=1e30f;
    for(int ax=0; ax<3; ++ax){
        float d = (&b.halfExtent.x)[ax]-std::fabs((&local.x)[ax]);
        if(d<best){ best=d; n={0,0,0}; (&n.x)[ax]=((&local.x)[ax]<0?-1.0f:1.0f); }
    }
    h.normal=n; h.albedo=b.albedo; h.object="box";
    return true;
}
// Trace against reflected objects only (ground excluded): ground reflection
// rays must never re-hit the floor they started from.
inline HitInfo traceObjects(const Scene& s, float3 ro, float3 rd){
    HitInfo h;
    for(auto& sp : s.spheres) intersectSphere(ro,rd,sp,h);
    for(auto& bx : s.boxes) intersectBox(ro,rd,bx,h);
    return h;
}
inline HitInfo traceScene(const Scene& s, float3 ro, float3 rd){
    HitInfo h = traceObjects(s,ro,rd);
    float t;
    if(intersectPlane(ro,rd,s.groundPoint,s.groundNormal,t) && t<h.t){
        h.hit=true; h.t=t; h.position=ro+rd*t; h.normal=s.groundNormal;
        h.albedo=s.groundTint; h.object="ground";
    }
    return h;
}

// Procedural sky: smooth vertical gradient plus a soft "sun" lobe, so the
// environment fallback is deterministic frame to frame (no stale history).
inline float3 sampleSky(float3 dir){
    float y = saturate(dir.y*0.5f+0.5f);
    float3 horizon = {0.72f,0.78f,0.86f};
    float3 zenith  = {0.20f,0.35f,0.62f};
    float3 col = horizon*(1.0f-y)+zenith*y;
    float3 sunDir = normalize(float3{-0.45f,0.65f,-0.35f});
    float sun = std::pow(saturate(dot(dir,sunDir)), 48.0f);
    col = col + float3{1.0f,0.85f,0.55f}*sun*1.4f;
    return col;
}

inline float3 shadeScene(const Scene& s, float3 wp, float3 n, float3 albedo){
    (void)s; (void)wp;
    float3 ld=normalize(float3{-0.45f,0.80f,-0.35f});
    float diff=saturate(dot(n,ld))*0.75f+0.25f;
    float3 sky=sampleSky(n)*0.15f;
    return albedo*diff+sky;
}
