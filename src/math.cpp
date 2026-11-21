#include "math.hpp"

Mat4 multiply(const Mat4& a, const Mat4& b) {
    Mat4 r;
    for (int c = 0; c < 4; ++c) {
        for (int row = 0; row < 4; ++row) {
            float s = 0;
            for (int k = 0; k < 4; ++k)
                s += a.get(k, row) * b.get(c, k);
            r.at(c, row) = s;
        }
    }
    return r;
}

Mat4 perspective(float fovYRad, float aspect, float nearZ, float farZ) {
    // View space uses +z forward; maps [nearZ, farZ] to depth [0,1].
    Mat4 r;
    for (float& v : r.m) v = 0;
    const float f = 1.0f / std::tan(fovYRad * 0.5f);
    r.at(0, 0) = f / aspect;
    r.at(1, 1) = f;
    r.at(2, 2) = farZ / (farZ - nearZ);
    r.at(2, 3) = 1.0f;
    r.at(3, 2) = -(farZ * nearZ) / (farZ - nearZ);
    return r;
}

Mat4 ortho(float l, float r, float b, float t, float nearZ, float farZ) {
    // Maps view-space z in [nearZ, farZ] (positive toward the scene) to
    // forward depth [0,1].
    Mat4 o;
    for (float& v : o.m) v = 0;
    o.at(0, 0) = 2.0f / (r - l);
    o.at(1, 1) = 2.0f / (t - b);
    o.at(2, 2) = 1.0f / (farZ - nearZ);
    o.at(3, 0) = (l + r) / (l - r);
    o.at(3, 1) = (b + t) / (b - t);
    o.at(3, 2) = -nearZ / (farZ - nearZ);
    o.at(3, 3) = 1.0f;
    return o;
}

Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
    Vec3 f = normalize(center - eye);
    Vec3 s = normalize(cross(f, up));
    Vec3 u = cross(s, f);
    Mat4 r;
    r.at(0, 0) = s.x;  r.at(0, 1) = s.y;  r.at(0, 2) = s.z;
    r.at(1, 0) = u.x;  r.at(1, 1) = u.y;  r.at(1, 2) = u.z;
    r.at(2, 0) = f.x;  r.at(2, 1) = f.y;  r.at(2, 2) = f.z;
    r.at(3, 0) = -dot(s, eye);
    r.at(3, 1) = -dot(u, eye);
    r.at(3, 2) = -dot(f, eye);
    r.at(3, 3) = 1.0f;
    return r;
}

// Invert a rigid/affine view-style matrix (upper 3x3 orthonormal).
Mat4 invertAffine(const Mat4& m) {
    Mat4 out;
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c)
            out.at(c, r) = m.get(r, c);  // transpose of orthonormal rotation
    Vec3 negT{-m.get(3, 0), -m.get(3, 1), -m.get(3, 2)};
    Vec3 ti;
    ti.x = out.get(0, 0) * negT.x + out.get(1, 0) * negT.y + out.get(2, 0) * negT.z;
    ti.y = out.get(0, 1) * negT.x + out.get(1, 1) * negT.y + out.get(2, 1) * negT.z;
    ti.z = out.get(0, 2) * negT.x + out.get(1, 2) * negT.y + out.get(2, 2) * negT.z;
    out.at(3, 0) = ti.x;
    out.at(3, 1) = ti.y;
    out.at(3, 2) = ti.z;
    out.at(3, 3) = 1.0f;
    return out;
}
