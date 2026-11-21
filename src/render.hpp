#pragma once
#include "raster.hpp"
#include "csm.hpp"

struct RenderOptions {
    bool tintCascades = false;
    float shadowBias = 0.0025f;
};

// Full shaded view. shadowMaps align 1:1 with cascades.
void renderView(ColorBuffer& fb, const Scene& scene,
                const CameraState& cam, const CameraParams& camParams,
                const std::vector<Cascade>& cascades,
                const std::vector<ColorBuffer>& shadowMaps,
                const RenderOptions& opts);
