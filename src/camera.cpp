#include "camera.h"
#include <algorithm>
#include <cmath>

static Vec3 cross(const Vec3 &a, const Vec3 &b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

Camera Camera::orbit(float angle_deg, float half_extent) {
  const float rad = angle_deg * static_cast<float>(M_PI) / 180.0f;
  Camera c;
  c.forward = {std::sin(rad), 0.0f, -std::cos(rad)};
  const Vec3 center{0.5f, 0.5f, 0.5f};
  c.eye = center - c.forward * 2.0f;
  const Vec3 world_up{0.0f, 1.0f, 0.0f};
  c.right = cross(c.forward, world_up);
  c.up = cross(c.right, c.forward);
  c.half_w = half_extent;
  c.half_h = half_extent;
  return c;
}

void Camera::ray(int i, int j, int w, int h, Vec3 &ro, Vec3 &rd) const {
  const float u = ((i + 0.5f) / w * 2.0f - 1.0f) * half_w;
  const float v = ((j + 0.5f) / h * 2.0f - 1.0f) * half_h;
  ro = eye + right * u + up * v;
  rd = forward;
}

bool intersect_box(const Vec3 &ro, const Vec3 &rd, float &t0, float &t1) {
  float tmin = -1e30f, tmax = 1e30f;
  const float o[3] = {ro.x, ro.y, ro.z};
  const float d[3] = {rd.x, rd.y, rd.z};
  for (int a = 0; a < 3; ++a) {
    float ta, tb;
    if (std::fabs(d[a]) < 1e-12f) {
      if (o[a] < 0.0f || o[a] > 1.0f) return false;
      continue;
    }
    ta = (0.0f - o[a]) / d[a];
    tb = (1.0f - o[a]) / d[a];
    if (ta > tb) std::swap(ta, tb);
    tmin = std::max(tmin, ta);
    tmax = std::min(tmax, tb);
  }
  if (tmin >= tmax) return false;
  t0 = std::max(tmin, 0.0f);
  t1 = tmax;
  return true;
}
