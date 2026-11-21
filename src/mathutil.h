#pragma once
// Minimal row-major (row-vector) 3D math, matching HLSL mul(v, m) usage.
#include <cmath>

struct Vec3 { float x, y, z; };
struct Vec4 { float x, y, z, w; };
struct Mat4 { float m[4][4]; };

inline Vec3 V3(float x, float y, float z) { return Vec3{ x, y, z }; }
inline Vec4 V4(float x, float y, float z, float w) { return Vec4{ x, y, z, w }; }

inline Vec3 Vec3Normalize(Vec3 v) {
    float l = sqrtf(v.x * v.x + v.y * v.y + v.z * v.z) + 1e-12f;
    return V3(v.x / l, v.y / l, v.z / l);
}
inline Vec3 Vec3Sub(Vec3 a, Vec3 b) { return V3(a.x - b.x, a.y - b.y, a.z - b.z); }
inline Vec3 Vec3Cross(Vec3 a, Vec3 b) {
    return V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
inline float Vec3Dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

inline Mat4 Mat4Identity() {
    Mat4 r{};
    r.m[0][0] = r.m[1][1] = r.m[2][2] = r.m[3][3] = 1.0f;
    return r;
}

inline Mat4 Mat4Multiply(const Mat4& a, const Mat4& b) { // a applied first
    Mat4 r{};
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j)
            for (int k = 0; k < 4; ++k)
                r.m[i][j] += a.m[i][k] * b.m[k][j];
    return r;
}

inline Mat4 Mat4Transpose(const Mat4& a) {
    Mat4 r{};
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j)
            r.m[i][j] = a.m[j][i];
    return r;
}

inline Mat4 Mat4Translation(float x, float y, float z) {
    Mat4 r = Mat4Identity();
    r.m[3][0] = x; r.m[3][1] = y; r.m[3][2] = z;
    return r;
}

inline Mat4 Mat4RotationX(float a) {
    Mat4 r = Mat4Identity();
    float c = cosf(a), s = sinf(a);
    r.m[1][1] = c;  r.m[1][2] = s;
    r.m[2][1] = -s; r.m[2][2] = c;
    return r;
}
inline Mat4 Mat4RotationY(float a) {
    Mat4 r = Mat4Identity();
    float c = cosf(a), s = sinf(a);
    r.m[0][0] = c;  r.m[0][2] = -s;
    r.m[2][0] = s;  r.m[2][2] = c;
    return r;
}
inline Mat4 Mat4RotationZ(float a) {
    Mat4 r = Mat4Identity();
    float c = cosf(a), s = sinf(a);
    r.m[0][0] = c;  r.m[0][1] = s;
    r.m[1][0] = -s; r.m[1][1] = c;
    return r;
}

inline Mat4 Mat4PerspectiveFovLH(float fovY, float aspect, float zn, float zf) {
    Mat4 r{};
    float yScale = 1.0f / tanf(fovY * 0.5f);
    r.m[0][0] = yScale / aspect;
    r.m[1][1] = yScale;
    r.m[2][2] = zf / (zf - zn);
    r.m[2][3] = 1.0f;
    r.m[3][2] = -zn * zf / (zf - zn);
    return r;
}

inline Mat4 Mat4LookAtLH(Vec3 eye, Vec3 at, Vec3 up) {
    Vec3 z = Vec3Normalize(Vec3Sub(at, eye));
    Vec3 x = Vec3Normalize(Vec3Cross(up, z));
    Vec3 y = Vec3Cross(z, x);
    Mat4 r = Mat4Identity();
    r.m[0][0] = x.x; r.m[1][0] = x.y; r.m[2][0] = x.z;
    r.m[0][1] = y.x; r.m[1][1] = y.y; r.m[2][1] = y.z;
    r.m[0][2] = z.x; r.m[1][2] = z.y; r.m[2][2] = z.z;
    r.m[3][0] = -Vec3Dot(x, eye);
    r.m[3][1] = -Vec3Dot(y, eye);
    r.m[3][2] = -Vec3Dot(z, eye);
    return r;
}
