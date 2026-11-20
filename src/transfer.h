#pragma once
#include <vector>

struct TFPoint {
  float s;             // scalar in [0,1]
  float r, g, b;       // emissive color
  float sigma;         // extinction coefficient (1 / world unit)
};

// Piecewise-linear emission/absorption transfer function.
struct TransferFunc {
  std::vector<TFPoint> pts;

  // Exact piecewise-linear evaluation.
  void eval(float s, float c[3], float &sigma) const;

  // 1D LUT, res entries of RGBA (rgb = color, a = sigma).
  std::vector<float> build_lut1d(int res) const;

  // Pre-integrated 2D LUT (Engel et al. 2001), res x res entries of RGBA,
  // indexed by (s_front, s_back). Assumes the scalar varies linearly along
  // a segment of length step_len; stores the exact segment emission
  // integral (rgb) and segment transmittance (a) for that length.
  std::vector<float> build_preint(int res, float step_len,
                                  int substeps) const;
};

// Default transfer function used by the viewer and the regression suite.
TransferFunc default_transfer_func();
