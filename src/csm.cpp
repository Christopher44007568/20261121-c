#include "csm.hpp"
#include <algorithm>

std::vector<float> cascadeSplits(const CSMConfig& cfg) {
    const int n = kCascadeCount;
    std::vector<float> d(n + 1);
    d[0] = cfg.cameraNear;
    d[n] = cfg.cameraFar;
    const float nearZ = cfg.cameraNear;
    const float farZ = cfg.cameraFar;
    for (int i = 1; i < n; ++i) {
        float t = static_cast<float>(i) / n;
        float uniform = nearZ + (farZ - nearZ) * t;
        float logSplit = nearZ * std::pow(farZ / nearZ, t);
        d[i] = cfg.blendLambda * logSplit + (1.0f - cfg.blendLambda) * uniform;
    }
    return d;
}

Cascade fitCascade(int index, float nearDepth, float farDepth,
                   const CameraState& cam, const CameraParams& camParams,
                   const Vec3& lightDir, const CSMConfig& cfg) {
    Cascade c;
    c.index = index;
    c.nearDepth = nearDepth;
    c.farDepth = farDepth;

    Vec3 corners[8];
    frustumCorners(cam, camParams, nearDepth, farDepth, corners);

    Vec3 center(0, 0, 0);
    for (const Vec3& v : corners) center += v;
    center = center / 8.0f;
    float radius = 0;
    for (const Vec3& v : corners)
        radius = std::max(radius, length(v - center));
    c.fitCenter = center;
    c.sphereRadius = radius;

    // Stable light axes: keep the up vector world-aligned so rotating the
    // viewpoint only translates (never skews) the light-space frustum.
    Vec3 lightUp(0, 1, 0);
    if (std::abs(dot(normalize(lightDir), lightUp)) > 0.95f)
        lightUp = Vec3(0, 0, 1);
    c.lightView = lookAt(center - lightDir, center, lightUp);

    c.texelWorld = (2.0f * radius) / cfg.shadowMapSize;

    // Snap the light-space origin onto an integer texel grid so camera
    // motion cannot make texels swim (sub-texel position jitter). The light
    // axes stay fixed; only the frustum center is translated.
    Vec3 centerInLight = transformPoint(c.lightView, center);
    c.preSnapGridX = centerInLight.x / c.texelWorld;
    c.preSnapGridY = centerInLight.y / c.texelWorld;
    float snappedX = std::round(centerInLight.x / c.texelWorld) * c.texelWorld;
    float snappedY = std::round(centerInLight.y / c.texelWorld) * c.texelWorld;
    c.snapResidualTexels = std::abs(centerInLight.x - snappedX) / c.texelWorld;
    c.snapResidualWorld = std::abs(centerInLight.x - snappedX);
    Vec3 shiftInLight(snappedX - centerInLight.x,
                      snappedY - centerInLight.y, 0.0f);
    Vec3 shiftWorld = transformDir(invertAffine(c.lightView), shiftInLight);
    c.snappedCenter = center + shiftWorld;
    c.snappedLightOrigin = Vec3(snappedX, snappedY, centerInLight.z);
    // Rebuild with identical orientation, translated position.
    c.lightView = lookAt(c.snappedCenter - lightDir, c.snappedCenter, lightUp);

    // Snapping can shift the frustum by up to half a texel; inflate the
    // ortho box by a full texel on every side to keep full coverage.
    float extent = radius + c.texelWorld;
    // Generous depth range: depth range does not cost xy texel density.
    c.lightProj = ortho(-extent, extent, -extent, extent,
                        -radius * 3.0f, radius * 3.0f);
    c.lightVP = multiply(c.lightProj, c.lightView);

    // Verify every frustum corner stays inside the fitted light frustum.
    c.frustumCovered = true;
    for (const Vec3& v : corners) {
        Vec3 ndc = projectLight(c, v);
        if (std::abs(ndc.x) > 1.0f || std::abs(ndc.y) > 1.0f ||
            ndc.z < 0.0f || ndc.z > 1.0f)
            c.frustumCovered = false;
    }
    return c;
}

Vec3 projectLight(const Cascade& c, const Vec3& world) {
    Vec4 clip = mul(c.lightVP, {world.x, world.y, world.z, 1.0f});
    // Forward [0,1] depth: perspective divide leaves z in [0,1].
    return {clip.x / clip.w, clip.y / clip.w, clip.z / clip.w};
}
