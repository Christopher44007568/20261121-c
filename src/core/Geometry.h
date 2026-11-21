#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace pcloud {

constexpr double kPi = 3.14159265358979323846;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    Vec3 operator+(const Vec3& other) const { return {x + other.x, y + other.y, z + other.z}; }
    Vec3 operator-(const Vec3& other) const { return {x - other.x, y - other.y, z - other.z}; }
    Vec3 operator*(double scalar) const { return {x * scalar, y * scalar, z * scalar}; }
    Vec3 operator/(double scalar) const { return {x / scalar, y / scalar, z / scalar}; }
    Vec3& operator+=(const Vec3& other) {
        x += other.x;
        y += other.y;
        z += other.z;
        return *this;
    }
};

inline double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

inline double lengthSquared(const Vec3& value) {
    return dot(value, value);
}

inline double length(const Vec3& value) {
    return std::sqrt(lengthSquared(value));
}

inline Vec3 normalized(const Vec3& value) {
    const double magnitude = length(value);
    return magnitude > 1e-12 ? value / magnitude : Vec3{0.0, 0.0, 1.0};
}

struct Box3 {
    Vec3 min;
    Vec3 max;

    Vec3 center() const { return (min + max) * 0.5; }
    Vec3 extent() const { return max - min; }

    double diagonal() const {
        return length(extent());
    }

    double radius() const {
        return diagonal() * 0.5;
    }

    bool contains(const Vec3& point) const {
        return point.x >= min.x && point.x <= max.x &&
               point.y >= min.y && point.y <= max.y &&
               point.z >= min.z && point.z <= max.z;
    }
};

struct CameraView {
    Vec3 position;
    Vec3 target;
    Vec3 up{0.0, 1.0, 0.0};
    double verticalFovDegrees = 45.0;
    int viewportHeight = 900;
};

inline double distanceToBox(const Vec3& point, const Box3& box) {
    const Vec3 center = box.center();
    const double distanceToCenter = length(point - center);
    return std::max(0.01, distanceToCenter - box.radius());
}

// Geometric error measured in world units, projected to pixels.
inline double screenSpaceError(const Box3& bounds, double geometricError, const CameraView& camera) {
    const double focalPixels =
        0.5 * static_cast<double>(camera.viewportHeight) /
        std::tan(0.5 * camera.verticalFovDegrees * kPi / 180.0);
    return geometricError * focalPixels / distanceToBox(camera.position, bounds);
}

struct Point {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    std::uint32_t rgba = 0xffffffffu;

    Vec3 asVec3() const {
        return {static_cast<double>(x), static_cast<double>(y), static_cast<double>(z)};
    }
};

static_assert(sizeof(Point) == 16, "Point must remain tightly packed for direct VBO upload");

inline std::uint32_t packRgba(std::uint8_t r, std::uint8_t g, std::uint8_t b, std::uint8_t a = 255) {
    return static_cast<std::uint32_t>(r) |
           (static_cast<std::uint32_t>(g) << 8u) |
           (static_cast<std::uint32_t>(b) << 16u) |
           (static_cast<std::uint32_t>(a) << 24u);
}

}  // namespace pcloud
