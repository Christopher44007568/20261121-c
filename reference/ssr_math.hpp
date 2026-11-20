// Minimal float math helpers shared by the SSR reference implementation.
// The same conventions (view space: +Z forward, right-handed, NDC z in [0,1])
// are mirrored in shaders/SSR.hlsli.
#pragma once
#include <cmath>
#include <cstdint>
#include <algorithm>

struct float2 { float x{}, y{}; };
inline float2 operator/(float2 a,float2 b){ return {a.x/b.x,a.y/b.y}; }
inline float2 operator*(float2 a,float s){ return {a.x*s,a.y*s}; }
inline float2 operator+(float2 a,float2 b){ return {a.x+b.x,a.y+b.y}; }
inline float length(float2 v){ return std::sqrt(v.x*v.x+v.y*v.y); }
inline float2 normalize(float2 v){ float l=length(v); return l>1e-12f?float2{v.x/l,v.y/l}:float2{0,0}; }
struct float3 { float x{}, y{}, z{}; };
struct float4 { float x{}, y{}, z{}, w{}; };

inline float3 operator+(float3 a, float3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
inline float3 operator-(float3 a, float3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
inline float3 operator*(float3 a, float s) { return {a.x*s,a.y*s,a.z*s}; }
inline float3 operator*(float s, float3 a) { return a*s; }
inline float3 operator/(float3 a, float s) { return a*(1.0f/s); }
inline float3 operator-(float3 a) { return {-a.x,-a.y,-a.z}; }

inline float dot(float3 a, float3 b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
inline float3 cross(float3 a, float3 b){
    return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x};
}
inline float length(float3 v){ return std::sqrt(dot(v,v)); }
inline float3 normalize(float3 v){ return v/length(v); }
inline float clamp(float x, float lo, float hi){ return std::min(hi, std::max(lo,x)); }
inline float lerp(float a, float b, float t){ return a+(b-a)*t; }
inline float saturate(float x){ return clamp(x,0.0f,1.0f); }

struct mat4 { float m[16]{}; };
inline mat4 identity(){ mat4 r; r.m[0]=r.m[5]=r.m[10]=r.m[15]=1.0f; return r; }
inline float4 mul(const mat4& M, float4 v){
    float4 r;
    r.x = M.m[0]*v.x+M.m[4]*v.y+M.m[8]*v.z+M.m[12]*v.w;
    r.y = M.m[1]*v.x+M.m[5]*v.y+M.m[9]*v.z+M.m[13]*v.w;
    r.z = M.m[2]*v.x+M.m[6]*v.y+M.m[10]*v.z+M.m[14]*v.w;
    r.w = M.m[3]*v.x+M.m[7]*v.y+M.m[11]*v.z+M.m[15]*v.w;
    return r;
}
inline mat4 mulM(const mat4& A, const mat4& B){
    mat4 R;
    for(int c=0;c<4;++c) for(int r=0;r<4;++r){
        R.m[c*4+r] = A.m[r]*B.m[c*4+0]+A.m[4+r]*B.m[c*4+1]+
                     A.m[8+r]*B.m[c*4+2]+A.m[12+r]*B.m[c*4+3];
    }
    return R;
}
// Row-vector convenience: transform point/vector by VP (column-major storage).
inline float3 transformPoint(const mat4& M, float3 p){
    float4 h = mul(M,{p.x,p.y,p.z,1.0f});
    return {h.x/h.w,h.y/h.w,h.z/h.w};
}
inline float3 transformDir(const mat4& M, float3 d){
    float4 h = mul(M,{d.x,d.y,d.z,0.0f});
    return {h.x,h.y,h.z};
}

// Right-handed perspective, NDC z in [0,1] (matches D3D).
inline mat4 perspectiveD3D(float fovY, float aspect, float zn, float zf){
    mat4 r{};
    float sy = 1.0f/std::tan(fovY*0.5f);
    float sx = sy/aspect;
    r.m[0]=sx; r.m[5]=sy;
    r.m[10]=zf/(zf-zn); r.m[11]=1.0f;
    r.m[14]=-zf*zn/(zf-zn);
    return r;
}
inline mat4 lookAt(float3 eye, float3 at, float3 up){
    // D3D convention: camera looks down +Z, +Y up, +X right.
    float3 z = normalize(at-eye);
    float3 x = normalize(cross(z,up));
    float3 y = cross(x,z);
    mat4 r = identity();
    r.m[0]=x.x; r.m[1]=x.y; r.m[2]=x.z;
    r.m[4]=y.x; r.m[5]=y.y; r.m[6]=y.z;
    r.m[8]=z.x; r.m[9]=z.y; r.m[10]=z.z;
    r.m[12]=-dot(x,eye); r.m[13]=-dot(y,eye); r.m[14]=-dot(z,eye);
    return r;
}
