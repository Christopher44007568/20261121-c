#include "core/PlaneSampler.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace micro {

SlicePlane makeTiltedPlane(const Vec3 &centerUm, double tiltXDeg,
                           double tiltYDeg, double halfWidthUm,
                           double halfHeightUm) {
    const double rx = degToRad(tiltXDeg);
    const double ry = degToRad(tiltYDeg);
    SlicePlane plane;
    plane.centerUm = centerUm;
    plane.uAxis = rotateX(rotateY({1.0, 0.0, 0.0}, ry), rx).normalized();
    plane.vAxis = rotateX(rotateY({0.0, 1.0, 0.0}, ry), rx).normalized();
    plane.halfWidthUm = halfWidthUm;
    plane.halfHeightUm = halfHeightUm;
    return plane;
}

SliceImage renderPlane(const Volume &volume, const SlicePlane &plane,
                       int width, int height, Interpolation interpolation,
                       float windowLow, float windowHigh, double gamma) {
    SliceImage image;
    image.width = std::max(1, width);
    image.height = std::max(1, height);
    image.halfWidthUm = plane.halfWidthUm;
    image.halfHeightUm = plane.halfHeightUm;
    image.rgba.resize(static_cast<size_t>(image.width) *
                      static_cast<size_t>(image.height) * 4);
    image.sampleMin = std::numeric_limits<float>::max();
    image.sampleMax = std::numeric_limits<float>::lowest();

    const auto &geometry = volume.geometry();
    const double low = windowHigh > windowLow ? windowLow : 0.0;
    const double high = windowHigh > windowLow ? windowHigh : 1.0;
    const double invRange = 1.0 / (high - low);
    const double safeGamma = std::max(0.05, gamma);

    for (int py = 0; py < image.height; ++py) {
        const double vLocal = (1.0 - (py + 0.5) / image.height * 2.0) *
                              plane.halfHeightUm;
        for (int px = 0; px < image.width; ++px) {
            const double uLocal = ((px + 0.5) / image.width * 2.0 - 1.0) *
                                  plane.halfWidthUm;
            const Vec3 world = plane.pointAt(uLocal, vLocal);
            const bool inside = geometry.boundsUm().contains(world, 1e-7);
            const size_t offset =
                (static_cast<size_t>(py) * image.width + px) * 4;
            if (!inside) {
                image.rgba[offset + 0] = 5;
                image.rgba[offset + 1] = 8;
                image.rgba[offset + 2] = 12;
                image.rgba[offset + 3] = 0;
                continue;
            }

            float value = volume.sampleWorld(world, interpolation);
            if (!std::isfinite(value)) {
                value = 0.0f;
            }
            image.sampleMin = std::min(image.sampleMin, value);
            image.sampleMax = std::max(image.sampleMax, value);
            const double normalized =
                clampd((value - low) * invRange, 0.0, 1.0);
            const auto gray = static_cast<std::uint8_t>(
                std::lround(std::pow(normalized, safeGamma) * 255.0));
            image.rgba[offset + 0] = gray;
            image.rgba[offset + 1] = gray;
            image.rgba[offset + 2] = gray;
            image.rgba[offset + 3] = 255;
            ++image.insidePixels;
        }
    }
    if (image.insidePixels == 0) {
        image.sampleMin = 0.0f;
        image.sampleMax = 0.0f;
    }
    return image;
}

} // namespace micro

