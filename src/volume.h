#pragma once
#include <vector>

// Scalar volume on the unit cube [0,1]^3, n^3 samples at cell centers.
struct Volume {
  int n = 0;
  std::vector<float> data; // z-major: data[(z*n + y)*n + x]

  float at(int x, int y, int z) const {
    return data[(static_cast<size_t>(z) * n + y) * n + x];
  }
  // Trilinear sample in world coordinates, matching GL_LINEAR on a
  // cell-centered texture (clamped at the boundary).
  float sample(float x, float y, float z) const;
};

Volume make_uniform(int n, float s);

struct SlabDef {
  float z_center;    // world units in [0,1]
  float thickness;   // world units (may be sub-voxel)
};
// Axis-aligned slabs (normal = z) with sharp density transitions.
// Voxel values are coverage-weighted so sub-voxel slabs are represented
// as linear ramps under trilinear interpolation.
Volume make_slabs(int n, float s_bg, float s_hi, const std::vector<SlabDef> &slabs);
