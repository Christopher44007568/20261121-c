// Same two deterministic camera paths as reference/ssr_camera.hpp.
// Orbit: arcs around the scene; the red sphere leaves the left edge mid-path.
// Dolly: low floor-level move that drives the green sphere / yellow box off
// screen, exercising reflection history invalidation.
#pragma once
#include <DirectXMath.h>
#include <vector>
#include <string>

struct CameraKey { DirectX::XMFLOAT3 eye, target; };
struct CameraPath {
    std::string name;
    std::vector<CameraKey> keys;
    CameraKey Sample(float t) const {
        t = std::clamp(t, 0.0f, 1.0f);
        float f = t * (keys.size()-1);
        size_t i = std::min(keys.size()-2, (size_t)floorf(f));
        float k = f - (float)i;
        k = k*k*(3.0f-2.0f*k);
        auto lerp3=[](const DirectX::XMFLOAT3&a,const DirectX::XMFLOAT3&b,float s){
            return DirectX::XMFLOAT3(a.x+(b.x-a.x)*s,a.y+(b.y-a.y)*s,a.z+(b.z-a.z)*s);
        };
        return {lerp3(keys[i].eye,keys[i+1].eye,k),lerp3(keys[i].target,keys[i+1].target,k)};
    }
};

inline CameraPath MakeOrbitPath(){
    using namespace DirectX;
    CameraPath p; p.name="orbit";
    const float radius=7.0f;
    for(int i=0;i<=6;++i){
        float ang=-0.9f + 2.2f*i/6.0f;
        p.keys.push_back({{sinf(ang)*radius,3.2f+0.4f*sinf((float)i),cosf(ang)*radius},
                          {0,0.6f,0}});
    }
    return p;
}
inline CameraPath MakeDollyPath(){
    using namespace DirectX;
    CameraPath p; p.name="dolly";
    for(int i=0;i<=6;++i){
        float t=i/6.0f;
        p.keys.push_back({{-4.5f+9.0f*t,1.6f+0.5f*t,5.5f-3.3f*t},
                          {-1.0f+2.5f*t,0.5f,0.0f}});
    }
    return p;
}
