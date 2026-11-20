#pragma once

#include "core/Geometry.h"

#include <string>
#include <vector>

namespace micro {

enum class Interpolation { Nearest, Linear, Cubic };

inline const char *interpolationName(Interpolation mode) {
    switch (mode) {
    case Interpolation::Nearest:
        return "nearest";
    case Interpolation::Linear:
        return "linear";
    case Interpolation::Cubic:
        return "cubic";
    }
    return "linear";
}

inline const char *interpolationDisplayName(Interpolation mode) {
    switch (mode) {
    case Interpolation::Nearest:
        return "最近邻";
    case Interpolation::Linear:
        return "三线性";
    case Interpolation::Cubic:
        return "Catmull-Rom 三立方";
    }
    return "三线性";
}

struct VolumeGeometry {
    int nx = 0;
    int ny = 0;
    int nz = 0;
    Vec3 spacingUm{1.0, 1.0, 1.0};
    Vec3 originUm{0.0, 0.0, 0.0};

    bool valid() const { return nx > 0 && ny > 0 && nz > 0; }
    Vec3 extentUm() const {
        return {std::max(0, nx - 1) * spacingUm.x,
                std::max(0, ny - 1) * spacingUm.y,
                std::max(0, nz - 1) * spacingUm.z};
    }
    Vec3 centerUm() const { return originUm + extentUm() * 0.5; }
    Aabb boundsUm() const { return {originUm, originUm + extentUm()}; }
};

class Volume {
public:
    Volume() = default;
    explicit Volume(const VolumeGeometry &geometry);

    void reset(const VolumeGeometry &geometry);
    void clear();

    const VolumeGeometry &geometry() const { return m_geometry; }
    VolumeGeometry &geometry() { return m_geometry; }
    bool isEmpty() const { return m_data.empty(); }
    const std::vector<float> &data() const { return m_data; }
    std::vector<float> &data() { return m_data; }

    float *voxel(int x, int y, int z);
    const float *voxel(int x, int y, int z) const;
    float &at(int x, int y, int z);
    float at(int x, int y, int z) const;

    Vec3 indexToWorld(const Vec3 &index) const;
    Vec3 worldToIndex(const Vec3 &world) const;
    bool containsWorld(const Vec3 &world, double marginUm = 0.0) const;

    float sampleIndex(const Vec3 &index, Interpolation mode) const;
    float sampleWorld(const Vec3 &world, Interpolation mode) const;

    void setSpacingUm(const Vec3 &newSpacing);
    void refreshRange();
    float valueMin() const { return m_valueMin; }
    float valueMax() const { return m_valueMax; }

private:
    int linearIndex(int x, int y, int z) const {
        return (z * m_geometry.ny + y) * m_geometry.nx + x;
    }
    int clampAxis(int value, int high) const {
        return std::max(0, std::min(high, value));
    }
    static double cubicWeight(int tap, double t);

    VolumeGeometry m_geometry;
    std::vector<float> m_data;
    float m_valueMin = 0.0f;
    float m_valueMax = 1.0f;
};

} // namespace micro

