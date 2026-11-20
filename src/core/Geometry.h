#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <string>

namespace micro {

constexpr double kPi = 3.14159265358979323846264338327950288;

inline double degToRad(double value) { return value * kPi / 180.0; }
inline double radToDeg(double value) { return value * 180.0 / kPi; }
inline double clampd(double value, double lo, double hi) {
    return std::max(lo, std::min(hi, value));
}

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    Vec3() = default;
    Vec3(double xValue, double yValue, double zValue)
        : x(xValue), y(yValue), z(zValue) {}

    Vec3 operator+(const Vec3 &rhs) const { return {x + rhs.x, y + rhs.y, z + rhs.z}; }
    Vec3 operator-(const Vec3 &rhs) const { return {x - rhs.x, y - rhs.y, z - rhs.z}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3 operator*(double scale) const { return {x * scale, y * scale, z * scale}; }
    Vec3 operator/(double scale) const { return {x / scale, y / scale, z / scale}; }
    Vec3 &operator+=(const Vec3 &rhs) {
        x += rhs.x;
        y += rhs.y;
        z += rhs.z;
        return *this;
    }
    Vec3 &operator-=(const Vec3 &rhs) {
        x -= rhs.x;
        y -= rhs.y;
        z -= rhs.z;
        return *this;
    }
    Vec3 &operator*=(double scale) {
        x *= scale;
        y *= scale;
        z *= scale;
        return *this;
    }

    double &operator[](int axis) { return axis == 0 ? x : (axis == 1 ? y : z); }
    double operator[](int axis) const { return axis == 0 ? x : (axis == 1 ? y : z); }

    double lengthSquared() const { return x * x + y * y + z * z; }
    double length() const { return std::sqrt(lengthSquared()); }
    Vec3 normalized() const {
        const double len = length();
        return len > 1e-12 ? *this / len : Vec3{0.0, 0.0, 1.0};
    }
};

inline Vec3 operator*(double scale, const Vec3 &value) { return value * scale; }
inline double dot(const Vec3 &a, const Vec3 &b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 cross(const Vec3 &a, const Vec3 &b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline Vec3 lerp(const Vec3 &a, const Vec3 &b, double t) { return a + (b - a) * t; }
inline double distance(const Vec3 &a, const Vec3 &b) { return (a - b).length(); }

inline Vec3 rotateX(const Vec3 &p, double radians) {
    const double c = std::cos(radians);
    const double s = std::sin(radians);
    return {p.x, c * p.y - s * p.z, s * p.y + c * p.z};
}

inline Vec3 rotateY(const Vec3 &p, double radians) {
    const double c = std::cos(radians);
    const double s = std::sin(radians);
    return {c * p.x + s * p.z, p.y, -s * p.x + c * p.z};
}

inline Vec3 rotateZ(const Vec3 &p, double radians) {
    const double c = std::cos(radians);
    const double s = std::sin(radians);
    return {c * p.x - s * p.y, s * p.x + c * p.y, p.z};
}

struct Aabb {
    Vec3 min;
    Vec3 max;

    Vec3 size() const { return max - min; }
    Vec3 center() const { return (min + max) * 0.5; }
    double diagonal() const { return size().length(); }
    bool contains(const Vec3 &p, double margin = 0.0) const {
        return p.x >= min.x - margin && p.x <= max.x + margin &&
               p.y >= min.y - margin && p.y <= max.y + margin &&
               p.z >= min.z - margin && p.z <= max.z + margin;
    }
};

inline std::string formatNumber(double value, int decimals = 1) {
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%.*f", decimals, value);
    return buffer;
}

} // namespace micro

