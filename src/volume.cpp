#include "volume.h"
#include <algorithm>
#include <cmath>

float Volume::sample(float x, float y, float z) const {
  const float g[3] = {x * n - 0.5f, y * n - 0.5f, z * n - 0.5f};
  int i0[3];
  float f[3];
  for (int a = 0; a < 3; ++a) {
    i0[a] = static_cast<int>(std::floor(g[a]));
    f[a] = g[a] - i0[a];
    i0[a] = std::max(0, std::min(i0[a], n - 1));
  }
  const int i1[3] = {std::min(i0[0] + 1, n - 1), std::min(i0[1] + 1, n - 1),
                     std::min(i0[2] + 1, n - 1)};
  float acc = 0.0f;
  for (int dz = 0; dz < 2; ++dz) {
    const float wz = dz ? f[2] : 1.0f - f[2];
    const int iz = dz ? i1[2] : i0[2];
    for (int dy = 0; dy < 2; ++dy) {
      const float wy = dy ? f[1] : 1.0f - f[1];
      const int iy = dy ? i1[1] : i0[1];
      for (int dx = 0; dx < 2; ++dx) {
        const float wx = dx ? f[0] : 1.0f - f[0];
        const int ix = dx ? i1[0] : i0[0];
        acc += wx * wy * wz * at(ix, iy, iz);
      }
    }
  }
  return acc;
}

Volume make_uniform(int n, float s) {
  Volume v;
  v.n = n;
  v.data.assign(static_cast<size_t>(n) * n * n, s);
  return v;
}

Volume make_slabs(int n, float s_bg, float s_hi,
                  const std::vector<SlabDef> &slabs) {
  Volume v;
  v.n = n;
  v.data.assign(static_cast<size_t>(n) * n * n, s_bg);
  const float voxel = 1.0f / n;
  for (int z = 0; z < n; ++z) {
    const float z0 = z * voxel, z1 = z0 + voxel;
    float coverage = 0.0f;
    for (const SlabDef &s : slabs) {
      const float lo = s.z_center - 0.5f * s.thickness;
      const float hi = s.z_center + 0.5f * s.thickness;
      coverage += std::max(0.0f, std::min(z1, hi) - std::max(z0, lo)) / voxel;
    }
    coverage = std::min(coverage, 1.0f);
    const float val = s_bg + (s_hi - s_bg) * coverage;
    for (int y = 0; y < n; ++y)
      for (int x = 0; x < n; ++x)
        v.data[(static_cast<size_t>(z) * n + y) * n + x] = val;
  }
  return v;
}
