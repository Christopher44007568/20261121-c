#pragma once

#include <cmath>
#include <cstddef>

namespace oit {

constexpr float kPi = 3.14159265358979323846f;

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
inline Vec3 operator*(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator*(float s, Vec3 a) { return a * s; }
inline Vec3 operator/(Vec3 a, float s) { return {a.x / s, a.y / s, a.z / s}; }
inline Vec3 &operator+=(Vec3 &a, Vec3 b) { a = a + b; return a; }

inline float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(Vec3 a, Vec3 b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float length(Vec3 v) { return std::sqrt(dot(v, v)); }
inline Vec3 normalize(Vec3 v) {
    const float len = length(v);
    return len > 1.0e-8f ? v / len : Vec3{0.0f, 0.0f, 0.0f};
}
inline Vec3 mix(Vec3 a, Vec3 b, float t) { return a * (1.0f - t) + b * t; }

struct Vec4 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float w = 0.0f;
};

inline Vec4 operator+(Vec4 a, Vec4 b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w};
}
inline Vec4 operator*(Vec4 a, float s) {
    return {a.x * s, a.y * s, a.z * s, a.w * s};
}

struct Mat4 {
    float m[16] = {};
};

inline Mat4 identity() {
    Mat4 r;
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
    return r;
}

inline Mat4 operator*(const Mat4 &a, const Mat4 &b) {
    Mat4 r;
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += a.m[k * 4 + row] * b.m[col * 4 + k];
            }
            r.m[col * 4 + row] = sum;
        }
    }
    return r;
}

inline Vec4 operator*(const Mat4 &m, const Vec4 &v) {
    return {
        m.m[0] * v.x + m.m[4] * v.y + m.m[8] * v.z + m.m[12] * v.w,
        m.m[1] * v.x + m.m[5] * v.y + m.m[9] * v.z + m.m[13] * v.w,
        m.m[2] * v.x + m.m[6] * v.y + m.m[10] * v.z + m.m[14] * v.w,
        m.m[3] * v.x + m.m[7] * v.y + m.m[11] * v.z + m.m[15] * v.w,
    };
}

inline Vec3 transformPoint(const Mat4 &m, Vec3 p) {
    const Vec4 r = m * Vec4{p.x, p.y, p.z, 1.0f};
    return {r.x, r.y, r.z};
}

inline Mat4 perspective(float fovYRadians, float aspect, float nearPlane, float farPlane) {
    Mat4 r;
    const float f = 1.0f / std::tan(fovYRadians * 0.5f);
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[10] = (farPlane + nearPlane) / (nearPlane - farPlane);
    r.m[11] = -1.0f;
    r.m[14] = (2.0f * farPlane * nearPlane) / (nearPlane - farPlane);
    return r;
}

inline Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up) {
    const Vec3 f = normalize(center - eye);
    const Vec3 s = normalize(cross(f, up));
    const Vec3 u = cross(s, f);
    Mat4 r = identity();
    r.m[0] = s.x;
    r.m[4] = s.y;
    r.m[8] = s.z;
    r.m[1] = u.x;
    r.m[5] = u.y;
    r.m[9] = u.z;
    r.m[2] = -f.x;
    r.m[6] = -f.y;
    r.m[10] = -f.z;
    r.m[12] = -dot(s, eye);
    r.m[13] = -dot(u, eye);
    r.m[14] = dot(f, eye);
    return r;
}

inline float radians(float degrees) { return degrees * (kPi / 180.0f); }

}  // namespace oit
