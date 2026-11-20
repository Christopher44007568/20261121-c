#pragma once
#include "camera.h"
#include "transfer.h"
#include "volume.h"

struct RayResult {
  double r = 0, g = 0, b = 0;
  double transmittance = 1.0;
  bool hit = false;
};

// Reference emission/absorption integral along the ray through the
// continuous (trilinearly interpolated) scalar field, using the exact
// piecewise-linear transfer function. Quadrature: constant sub-segments
// of length h composited exactly in double precision.
RayResult reference_integral(const Volume &vol, const TransferFunc &tf,
                             const Vec3 &ro, const Vec3 &rd, double h);

// Closed-form solution for a uniform volume (scalar s everywhere):
// T = exp(-sigma*L), C = c * (1 - T) / sigma, L = path length in the box.
RayResult reference_uniform_analytic(const TransferFunc &tf, float s,
                                     double path_len);
