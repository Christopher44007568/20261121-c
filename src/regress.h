#pragma once
#include "renderer.h"
#include <string>

// Runs the regression suite:
//  - uniform volume vs closed-form analytic transmittance/color
//  - multi-thickness thin-slab volume vs fine-quadrature reference integral
//  - step-size consistency of pre-integrated vs post-classified rendering
// Writes per-config CSVs (per-ray reference integral and render error)
// plus summary.csv into outdir. Returns false on failure.
bool run_regression(Renderer &renderer, const std::string &outdir, int size);
