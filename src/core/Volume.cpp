#include "core/Volume.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace micro {

Volume::Volume(const VolumeGeometry &geometry) { reset(geometry); }

void Volume::reset(const VolumeGeometry &geometry) {
    if (!geometry.valid()) {
        throw std::invalid_argument("Volume dimensions must be positive");
    }
    const size_t count = static_cast<size_t>(geometry.nx) *
                         static_cast<size_t>(geometry.ny) *
                         static_cast<size_t>(geometry.nz);
    m_geometry = geometry;
    m_data.assign(count, 0.0f);
    m_valueMin = 0.0f;
    m_valueMax = 1.0f;
}

void Volume::clear() {
    m_data.clear();
    m_geometry = {};
    m_valueMin = 0.0f;
    m_valueMax = 1.0f;
}

float *Volume::voxel(int x, int y, int z) {
    return m_data.data() + linearIndex(x, y, z);
}

const float *Volume::voxel(int x, int y, int z) const {
    return m_data.data() + linearIndex(x, y, z);
}

float &Volume::at(int x, int y, int z) { return *voxel(x, y, z); }

float Volume::at(int x, int y, int z) const { return *voxel(x, y, z); }

Vec3 Volume::indexToWorld(const Vec3 &index) const {
    return {m_geometry.originUm.x + index.x * m_geometry.spacingUm.x,
            m_geometry.originUm.y + index.y * m_geometry.spacingUm.y,
            m_geometry.originUm.z + index.z * m_geometry.spacingUm.z};
}

Vec3 Volume::worldToIndex(const Vec3 &world) const {
    return {(world.x - m_geometry.originUm.x) / m_geometry.spacingUm.x,
            (world.y - m_geometry.originUm.y) / m_geometry.spacingUm.y,
            (world.z - m_geometry.originUm.z) / m_geometry.spacingUm.z};
}

bool Volume::containsWorld(const Vec3 &world, double marginUm) const {
    return m_geometry.boundsUm().contains(world, marginUm);
}

double Volume::cubicWeight(int tap, double t) {
    double result = 0.0;
    switch (tap) {
    case 0:
        result = -0.5 * t + t * t - 0.5 * t * t * t;
        break;
    case 1:
        result = 1.0 - 2.5 * t * t + 1.5 * t * t * t;
        break;
    case 2:
        result = 0.5 * t + 2.0 * t * t - 1.5 * t * t * t;
        break;
    default:
        result = -0.5 * t * t + 0.5 * t * t * t;
        break;
    }
    return result;
}

float Volume::sampleIndex(const Vec3 &index, Interpolation mode) const {
    const auto &g = m_geometry;
    if (index.x < 0.0 || index.y < 0.0 || index.z < 0.0 ||
        index.x > g.nx - 1.0 || index.y > g.ny - 1.0 ||
        index.z > g.nz - 1.0) {
        return 0.0f;
    }

    if (mode == Interpolation::Nearest) {
        const int x = clampAxis(static_cast<int>(std::lround(index.x)), g.nx - 1);
        const int y = clampAxis(static_cast<int>(std::lround(index.y)), g.ny - 1);
        const int z = clampAxis(static_cast<int>(std::lround(index.z)), g.nz - 1);
        return at(x, y, z);
    }

    if (mode == Interpolation::Linear) {
        const int x0 = std::min(static_cast<int>(std::floor(index.x)), g.nx - 1);
        const int y0 = std::min(static_cast<int>(std::floor(index.y)), g.ny - 1);
        const int z0 = std::min(static_cast<int>(std::floor(index.z)), g.nz - 1);
        const int x1 = std::min(x0 + 1, g.nx - 1);
        const int y1 = std::min(y0 + 1, g.ny - 1);
        const int z1 = std::min(z0 + 1, g.nz - 1);
        const double fx = index.x - x0;
        const double fy = index.y - y0;
        const double fz = index.z - z0;

        const double c00 = at(x0, y0, z0) * (1.0 - fx) + at(x1, y0, z0) * fx;
        const double c10 = at(x0, y1, z0) * (1.0 - fx) + at(x1, y1, z0) * fx;
        const double c01 = at(x0, y0, z1) * (1.0 - fx) + at(x1, y0, z1) * fx;
        const double c11 = at(x0, y1, z1) * (1.0 - fx) + at(x1, y1, z1) * fx;
        const double c0 = c00 * (1.0 - fy) + c10 * fy;
        const double c1 = c01 * (1.0 - fy) + c11 * fy;
        return static_cast<float>(c0 * (1.0 - fz) + c1 * fz);
    }

    const int bx = static_cast<int>(std::floor(index.x));
    const int by = static_cast<int>(std::floor(index.y));
    const int bz = static_cast<int>(std::floor(index.z));
    const double tx = index.x - bx;
    const double ty = index.y - by;
    const double tz = index.z - bz;

    double sum = 0.0;
    for (int dz = 0; dz < 4; ++dz) {
        const double wz = cubicWeight(dz, tz);
        const int z = clampAxis(bz - 1 + dz, g.nz - 1);
        for (int dy = 0; dy < 4; ++dy) {
            const double wy = cubicWeight(dy, ty);
            const int y = clampAxis(by - 1 + dy, g.ny - 1);
            for (int dx = 0; dx < 4; ++dx) {
                const int x = clampAxis(bx - 1 + dx, g.nx - 1);
                sum += cubicWeight(dx, tx) * wy * wz * at(x, y, z);
            }
        }
    }
    return static_cast<float>(sum);
}

float Volume::sampleWorld(const Vec3 &world, Interpolation mode) const {
    return sampleIndex(worldToIndex(world), mode);
}

void Volume::setSpacingUm(const Vec3 &newSpacing) {
    m_geometry.spacingUm = {std::max(1e-6, newSpacing.x),
                            std::max(1e-6, newSpacing.y),
                            std::max(1e-6, newSpacing.z)};
}

void Volume::refreshRange() {
    if (m_data.empty()) {
        m_valueMin = 0.0f;
        m_valueMax = 1.0f;
        return;
    }
    const auto [lo, hi] = std::minmax_element(m_data.begin(), m_data.end());
    m_valueMin = *lo;
    m_valueMax = *hi;
}

} // namespace micro

