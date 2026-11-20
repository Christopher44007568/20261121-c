#include "transfer.h"
#include <algorithm>
#include <cmath>

void TransferFunc::eval(float s, float c[3], float &sigma) const {
  s = std::max(0.0f, std::min(1.0f, s));
  size_t k = 0;
  while (k + 1 < pts.size() && pts[k + 1].s < s) ++k;
  const TFPoint &a = pts[k];
  const TFPoint &b = pts[std::min(k + 1, pts.size() - 1)];
  const float t = (b.s > a.s) ? (s - a.s) / (b.s - a.s) : 0.0f;
  c[0] = a.r + t * (b.r - a.r);
  c[1] = a.g + t * (b.g - a.g);
  c[2] = a.b + t * (b.b - a.b);
  sigma = a.sigma + t * (b.sigma - a.sigma);
}

std::vector<float> TransferFunc::build_lut1d(int res) const {
  std::vector<float> lut(static_cast<size_t>(res) * 4);
  for (int i = 0; i < res; ++i) {
    float c[3], sigma;
    eval((i + 0.5f) / res, c, sigma);
    lut[4 * i + 0] = c[0];
    lut[4 * i + 1] = c[1];
    lut[4 * i + 2] = c[2];
    lut[4 * i + 3] = sigma;
  }
  return lut;
}

std::vector<float> TransferFunc::build_preint(int res, float step_len,
                                              int substeps) const {
  std::vector<float> lut(static_cast<size_t>(res) * res * 4);
  const float h = step_len / substeps;
  for (int ifront = 0; ifront < res; ++ifront) {
    const float sf = (ifront + 0.5f) / res;
    for (int iback = 0; iback < res; ++iback) {
      const float sb = (iback + 0.5f) / res;
      // Front-to-back exact compositing of constant sub-segments.
      double acc[3] = {0.0, 0.0, 0.0};
      double trans = 1.0;
      for (int k = 0; k < substeps; ++k) {
        const float t = (k + 0.5f) / substeps;
        float c[3], sigma;
        eval(sf + t * (sb - sf), c, sigma);
        const double tsub = std::exp(-static_cast<double>(sigma) * h);
        // Integral of constant emission c with extinction sigma over h:
        // c * (1 - exp(-sigma*h)) / sigma  (== c*h for sigma -> 0).
        const double w = (sigma > 1e-6f)
                             ? (1.0 - tsub) / sigma
                             : h * (1.0 - 0.5 * sigma * h);
        for (int ch = 0; ch < 3; ++ch) acc[ch] += trans * c[ch] * w;
        trans *= tsub;
      }
      // Texture layout: x = s_front, y = s_back (matches the shader lookup
      // texture(preintLut, vec2(s_front, s_back))).
      const size_t o = (static_cast<size_t>(iback) * res + ifront) * 4;
      lut[o + 0] = static_cast<float>(acc[0]);
      lut[o + 1] = static_cast<float>(acc[1]);
      lut[o + 2] = static_cast<float>(acc[2]);
      lut[o + 3] = static_cast<float>(trans);
    }
  }
  return lut;
}

TransferFunc default_transfer_func() {
  TransferFunc tf;
  tf.pts = {
      {0.00f, 0.00f, 0.00f, 0.00f, 0.0f},
      {0.10f, 0.05f, 0.02f, 0.00f, 1.0f},
      {0.30f, 0.30f, 0.10f, 0.02f, 8.0f},
      {0.55f, 0.85f, 0.35f, 0.08f, 40.0f},
      {0.75f, 1.00f, 0.85f, 0.25f, 90.0f},
      {1.00f, 1.00f, 1.00f, 1.00f, 160.0f},
  };
  return tf;
}
