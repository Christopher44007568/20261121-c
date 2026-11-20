#pragma once

struct Vec3 {
  float x, y, z;
  Vec3 operator+(const Vec3 &o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3 &o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
};

// Orthographic camera orbiting the unit cube centered at (0.5, 0.5, 0.5).
struct Camera {
  Vec3 eye, right, up, forward;
  float half_w, half_h;

  // angle_deg: rotation around the Y axis (0 = looking down -Z).
  static Camera orbit(float angle_deg, float half_extent = 0.75f);

  // Ray for pixel (i, j) of a W x H image (same math as the shader).
  void ray(int i, int j, int w, int h, Vec3 &ro, Vec3 &rd) const;
};

// Ray / unit-box intersection; returns false on miss, else [t0, t1].
bool intersect_box(const Vec3 &ro, const Vec3 &rd, float &t0, float &t1);
