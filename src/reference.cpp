#include "reference.h"
#include <cmath>

RayResult reference_integral(const Volume &vol, const TransferFunc &tf,
                             const Vec3 &ro, const Vec3 &rd, double h) {
  RayResult out;
  float t0, t1;
  if (!intersect_box(ro, rd, t0, t1)) return out;
  out.hit = true;
  double acc[3] = {0.0, 0.0, 0.0};
  double trans = 1.0;
  const double len = t1 - t0;
  const long steps = std::max(1L, static_cast<long>(std::ceil(len / h)));
  const double hh = len / steps;
  for (long k = 0; k < steps; ++k) {
    const double t = t0 + (k + 0.5) * hh;
    const float s = vol.sample(static_cast<float>(ro.x + rd.x * t),
                               static_cast<float>(ro.y + rd.y * t),
                               static_cast<float>(ro.z + rd.z * t));
    float c[3], sigma;
    tf.eval(s, c, sigma);
    const double tsub = std::exp(-static_cast<double>(sigma) * hh);
    const double w = (sigma > 1e-6f) ? (1.0 - tsub) / sigma
                                     : hh * (1.0 - 0.5 * sigma * hh);
    for (int ch = 0; ch < 3; ++ch) acc[ch] += trans * c[ch] * w;
    trans *= tsub;
  }
  out.r = acc[0];
  out.g = acc[1];
  out.b = acc[2];
  out.transmittance = trans;
  return out;
}

RayResult reference_uniform_analytic(const TransferFunc &tf, float s,
                                     double path_len) {
  RayResult out;
  out.hit = true;
  float c[3], sigma;
  tf.eval(s, c, sigma);
  const double trans = std::exp(-static_cast<double>(sigma) * path_len);
  const double w =
      (sigma > 1e-6f) ? (1.0 - trans) / sigma : path_len;
  out.r = c[0] * w;
  out.g = c[1] * w;
  out.b = c[2] * w;
  out.transmittance = trans;
  return out;
}
