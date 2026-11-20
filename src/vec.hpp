#pragma once
#include <cmath>

struct Vec3 {
  double x = 0.0, y = 0.0, z = 0.0;
};

inline Vec3 operator+(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 operator-(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 operator*(const Vec3& a, double s) {
  return {a.x * s, a.y * s, a.z * s};
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y,
          a.z * b.x - a.x * b.z,
          a.x * b.y - a.y * b.x};
}
inline double dot(const Vec3& a, const Vec3& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 lerp(const Vec3& a, const Vec3& b, double t) {
  return a + (b - a) * t;
}
