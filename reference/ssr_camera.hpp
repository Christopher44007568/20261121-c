// Two deterministic camera paths used by both the reference tool and (via the
// same keyframe tables) the D3D12 demo's camera controller.
#pragma once
#include "ssr_math.hpp"
#include <vector>
#include <string>

struct CameraKey { float3 eye; float3 target; };
struct CameraPath {
    std::string name;
    std::vector<CameraKey> keys;
    CameraKey sample(float t) const {
        t=saturate(t);
        float f=t*(keys.size()-1);
        size_t i=std::min(keys.size()-2,(size_t)std::floor(f));
        float k=f-(float)i;
        // Smoothstep for eased motion.
        k=k*k*(3.0f-2.0f*k);
        CameraKey a=keys[i], b=keys[i+1];
        return {a.eye*(1.0f-k)+b.eye*k, a.target*(1.0f-k)+b.target*k};
    }
};

// Path A: orbit around the scene. Mid-orbit the red sphere leaves the left
// edge of the screen, exercising off-screen invalidation of its reflection.
inline CameraPath pathOrbit(){
    CameraPath p; p.name="orbit";
    float radius=7.0f;
    for(int i=0;i<=6;++i){
        float ang=-0.9f + 2.2f*i/6.0f;
        float3 eye{std::sin(ang)*radius, 3.2f+0.4f*(float)std::sin((float)i), std::cos(ang)*radius};
        p.keys.push_back({eye,{0,0.6f,0}});
    }
    return p;
}

// Path B: low dolly across the floor mirror, ending by dropping the green
// sphere and yellow box behind the camera / below the screen edge.
inline CameraPath pathDolly(){
    CameraPath p; p.name="dolly";
    for(int i=0;i<=6;++i){
        float t=i/6.0f;
        float3 eye{lerp(-4.5f,4.5f,t), 1.6f+0.5f*t, lerp(5.5f,2.2f,t)};
        p.keys.push_back({eye,{lerp(-1.0f,1.5f,t),0.5f,0.0f}});
    }
    return p;
}
