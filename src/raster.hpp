#pragma once
#include "math.hpp"
#include "scene.hpp"
#include <vector>

struct RGB {
    uint8_t r = 0, g = 0, b = 0;
};

struct ColorBuffer {
    int width = 0, height = 0;
    std::vector<RGB> color;
    std::vector<float> depth;
    ColorBuffer() = default;
    ColorBuffer(int w, int h) { resize(w, h); }
    void resize(int w, int h) {
        width = w; height = h;
        color.assign(w * h, RGB{});
        depth.assign(w * h, 1.0f);
    }
    void clear(const RGB& bg);
};

struct ClipVertex {
    Vec4 clip;
    Vec3 world;
};

// Sutherland-Hodgman clip of one triangle against all six clip planes.
std::vector<ClipVertex> clipToFrustum(const ClipVertex& a,
                                      const ClipVertex& b,
                                      const ClipVertex& c);

// Depth-only pass into a shadow map; forward [0,1] min-depth convention.
struct ShadowRenderOpts {
    float texelWorld = 0.0f;   // >0 enables normal-offset bias
};
void renderShadowDepth(ColorBuffer& shadowMap, const Scene& scene,
                       const Mat4& lightVP,
                       const ShadowRenderOpts& opts = ShadowRenderOpts{});

// Lookup stored shadow depth at the given shadow-map pixel (nearest).
float shadowSample(const ColorBuffer& map, int x, int y);
