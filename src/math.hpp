#pragma once
#include <cmath>
#include <cstdint>

struct Vec3 {
    float x = 0, y = 0, z = 0;
    Vec3() = default;
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3 operator-() const { return {-x, -y, -z}; }
};

inline float dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline float length(const Vec3& v) { return std::sqrt(dot(v, v)); }
inline Vec3 normalize(const Vec3& v) {
    float l = length(v);
    return l > 1e-12f ? v / l : Vec3(0, 0, 1);
}

// Column-major 4x4, matching the conventional OpenGL memory layout.
struct Mat4 {
    float m[16] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    float& at(int col, int row) { return m[col * 4 + row]; }
    float get(int col, int row) const { return m[col * 4 + row]; }
};

Mat4 multiply(const Mat4& a, const Mat4& b);

struct Vec4 {
    float x = 0, y = 0, z = 0, w = 1;
};

inline Vec4 mul(const Mat4& m, const Vec4& v) {
    Vec4 r;
    r.x = m.get(0,0)*v.x + m.get(1,0)*v.y + m.get(2,0)*v.z + m.get(3,0)*v.w;
    r.y = m.get(0,1)*v.x + m.get(1,1)*v.y + m.get(2,1)*v.z + m.get(3,1)*v.w;
    r.z = m.get(0,2)*v.x + m.get(1,2)*v.y + m.get(2,2)*v.z + m.get(3,2)*v.w;
    r.w = m.get(0,3)*v.x + m.get(1,3)*v.y + m.get(2,3)*v.z + m.get(3,3)*v.w;
    return r;
}

inline Vec3 transformPoint(const Mat4& m, const Vec3& p) {
    Vec4 r = mul(m, {p.x, p.y, p.z, 1.0f});
    return {r.x / r.w, r.y / r.w, r.z / r.w};
}

inline Vec3 transformDir(const Mat4& m, const Vec3& d) {
    Vec4 r = mul(m, {d.x, d.y, d.z, 0.0f});
    return {r.x, r.y, r.z};
}

// Forward [0,1] depth: near plane maps to 0, far plane to 1.
Mat4 perspective(float fovYRad, float aspect, float nearZ, float farZ);
// Orthographic box, again depth in [0,1].
Mat4 ortho(float l, float r, float b, float t, float nearZ, float farZ);
Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up);
Mat4 invertAffine(const Mat4& m);
