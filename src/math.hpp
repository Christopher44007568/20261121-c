#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

constexpr float kPi = 3.14159265358979323846f;

inline float clampf(float x, float lo, float hi) {
    return std::max(lo, std::min(hi, x));
}

struct Vec2 {
    float x = 0.0f;
    float y = 0.0f;
};

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

inline Vec3 operator+(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator-(Vec3 v) { return {-v.x, -v.y, -v.z}; }
inline Vec3 operator*(Vec3 v, float s) { return {v.x * s, v.y * s, v.z * s}; }
inline Vec3 operator*(float s, Vec3 v) { return v * s; }
inline Vec3 operator/(Vec3 v, float s) { return {v.x / s, v.y / s, v.z / s}; }
inline Vec3& operator+=(Vec3& a, Vec3 b) { a = a + b; return a; }

inline float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(Vec3 a, Vec3 b) {
    return {
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    };
}
inline float lengthSquared(Vec3 v) { return dot(v, v); }
inline float length(Vec3 v) { return std::sqrt(lengthSquared(v)); }
inline Vec3 normalize(Vec3 v) {
    const float n = length(v);
    return n > 1e-8f ? v / n : Vec3{0.0f, 0.0f, 0.0f};
}
inline Vec3 lerp(Vec3 a, Vec3 b, float t) { return a + (b - a) * t; }

struct Vec4 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float w = 0.0f;
};

struct Mat4 {
    std::array<float, 16> m{};

    static Mat4 identity() {
        Mat4 r;
        r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
        return r;
    }

    static Mat4 perspective(float fovyRadians, float aspect, float nearPlane, float farPlane) {
        Mat4 r;
        const float f = 1.0f / std::tan(fovyRadians * 0.5f);
        r.m[0] = f / aspect;
        r.m[5] = f;
        r.m[10] = (farPlane + nearPlane) / (nearPlane - farPlane);
        r.m[11] = -1.0f;
        r.m[14] = (2.0f * farPlane * nearPlane) / (nearPlane - farPlane);
        return r;
    }

    static Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up) {
        const Vec3 f = normalize(center - eye);
        const Vec3 s = normalize(cross(f, up));
        const Vec3 u = cross(s, f);
        Mat4 r = identity();
        r.m[0] = s.x;  r.m[4] = s.y;  r.m[8]  = s.z;  r.m[12] = -dot(s, eye);
        r.m[1] = u.x;  r.m[5] = u.y;  r.m[9]  = u.z;  r.m[13] = -dot(u, eye);
        r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z; r.m[14] = dot(f, eye);
        return r;
    }

    float at(int row, int col) const { return m[col * 4 + row]; }
    float& at(int row, int col) { return m[col * 4 + row]; }

    Mat4 operator*(const Mat4& rhs) const {
        Mat4 r;
        for (int col = 0; col < 4; ++col) {
            for (int row = 0; row < 4; ++row) {
                float value = 0.0f;
                for (int k = 0; k < 4; ++k) {
                    value += at(row, k) * rhs.at(k, col);
                }
                r.at(row, col) = value;
            }
        }
        return r;
    }

    Vec4 operator*(Vec4 v) const {
        return {
            at(0, 0) * v.x + at(0, 1) * v.y + at(0, 2) * v.z + at(0, 3) * v.w,
            at(1, 0) * v.x + at(1, 1) * v.y + at(1, 2) * v.z + at(1, 3) * v.w,
            at(2, 0) * v.x + at(2, 1) * v.y + at(2, 2) * v.z + at(2, 3) * v.w,
            at(3, 0) * v.x + at(3, 1) * v.y + at(3, 2) * v.z + at(3, 3) * v.w,
        };
    }
};

struct Ray {
    Vec3 origin;
    Vec3 direction;
};

struct RayHit {
    bool hit = false;
    float t = 0.0f;
    Vec3 position;
    Vec3 normal;
    int object = -1;
    int triangle = -1;
};

inline bool rayTriangle(const Ray& ray, Vec3 a, Vec3 b, Vec3 c, float minT, float maxT,
                        float& outT, Vec3& outNormal) {
    const Vec3 e1 = b - a;
    const Vec3 e2 = c - a;
    const Vec3 p = cross(ray.direction, e2);
    const float det = dot(e1, p);
    if (std::abs(det) < 1e-8f) {
        return false;
    }
    const float invDet = 1.0f / det;
    const Vec3 s = ray.origin - a;
    const float u = dot(s, p) * invDet;
    if (u < 0.0f || u > 1.0f) {
        return false;
    }
    const Vec3 q = cross(s, e1);
    const float v = dot(ray.direction, q) * invDet;
    if (v < 0.0f || u + v > 1.0f) {
        return false;
    }
    const float t = dot(e2, q) * invDet;
    if (t < minT || t > maxT) {
        return false;
    }
    Vec3 normal = normalize(cross(e1, e2));
    outT = t;
    outNormal = normal;
    return true;
}

inline bool rayPlane(Ray ray, Vec3 planePoint, Vec3 planeNormal, float minT, float maxT,
                     float& outT) {
    const float denom = dot(ray.direction, planeNormal);
    if (std::abs(denom) < 1e-8f) {
        return false;
    }
    const float t = dot(planePoint - ray.origin, planeNormal) / denom;
    if (t < minT || t > maxT) {
        return false;
    }
    outT = t;
    return true;
}

inline float radians(float degrees) { return degrees * kPi / 180.0f; }
