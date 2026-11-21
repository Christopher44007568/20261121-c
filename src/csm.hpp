#pragma once
#include "math.hpp"
#include "camera.hpp"
#include <vector>

constexpr int kCascadeCount = 4;
constexpr int kShadowMapSize = 1024;

struct Cascade {
    int index = 0;
    float nearDepth = 0;
    float farDepth = 0;
    Mat4 lightView;
    Mat4 lightProj;
    Mat4 lightVP;
    Vec3 fitCenter;
    float sphereRadius = 0;
    float texelWorld = 0;       // ortho extent covered by one shadow texel
    Vec3 snappedCenter;
    Vec3 snappedLightOrigin;   // snapped center expressed in light-view units
    float preSnapGridX = 0;  // light-space center in texel units, pre-snap
    float preSnapGridY = 0;
    float snapResidualTexels = 0;
    float snapResidualWorld = 0;
    bool frustumCovered = true;
};

struct CSMConfig {
    float cameraNear = 0.5f;
    float cameraFar = 110.0f;
    int shadowMapSize = kShadowMapSize;
    float blendLambda = 0.65f;
};

// Hybrid logarithmic/uniform split depths in camera-view space.
std::vector<float> cascadeSplits(const CSMConfig& cfg);

// Fit a stable, texel-snapped directional light frustum around one slice.
Cascade fitCascade(int index, float nearDepth, float farDepth,
                   const CameraState& cam, const CameraParams& camParams,
                   const Vec3& lightDir, const CSMConfig& cfg);

// Project a world point into light clip space [0,1]^3.
Vec3 projectLight(const Cascade& c, const Vec3& world);
