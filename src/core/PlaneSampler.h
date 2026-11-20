#pragma once

#include "core/Volume.h"

#include <cstdint>
#include <vector>

namespace micro {

struct SlicePlane {
    Vec3 centerUm;
    Vec3 uAxis{1.0, 0.0, 0.0};
    Vec3 vAxis{0.0, 1.0, 0.0};
    double halfWidthUm = 500.0;
    double halfHeightUm = 500.0;

    Vec3 normal() const { return cross(uAxis, vAxis).normalized(); }
    Vec3 pointAt(double localU, double localV) const {
        return centerUm + uAxis * localU + vAxis * localV;
    }
    Vec3 worldToLocal(const Vec3 &world) const {
        const Vec3 delta = world - centerUm;
        return {dot(delta, uAxis), dot(delta, vAxis), dot(delta, normal())};
    }
    bool containsLocal(double u, double v, double marginUm = 0.0) const {
        return std::abs(u) <= halfWidthUm + marginUm &&
               std::abs(v) <= halfHeightUm + marginUm;
    }
};

SlicePlane makeTiltedPlane(const Vec3 &centerUm, double tiltXDeg,
                           double tiltYDeg, double halfWidthUm,
                           double halfHeightUm);

struct SliceImage {
    int width = 0;
    int height = 0;
    double halfWidthUm = 500.0;
    double halfHeightUm = 500.0;
    std::vector<std::uint8_t> rgba;
    int insidePixels = 0;
    float sampleMin = 0.0f;
    float sampleMax = 1.0f;
};

SliceImage renderPlane(const Volume &volume, const SlicePlane &plane,
                       int width, int height, Interpolation interpolation,
                       float windowLow, float windowHigh, double gamma = 1.0);

} // namespace micro

