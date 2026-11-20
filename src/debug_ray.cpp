// Debug: emulate the GPU pre-integrated pipeline on CPU for one ray and
// compare against the fine-quadrature reference.
#include "reference.h"
#include "transfer.h"
#include "volume.h"
#include <cmath>
#include <cstdlib>
#include <cstdio>

static void lut_sample(const std::vector<float> &lut, int res, float sf,
                       float sb, float out[4]) {
  const float x = sf * res - 0.5f, y = sb * res - 0.5f;
  const int x0 = std::max(0, std::min(static_cast<int>(x), res - 1));
  const int y0 = std::max(0, std::min(static_cast<int>(y), res - 1));
  const int x1 = std::min(x0 + 1, res - 1), y1 = std::min(y0 + 1, res - 1);
  const float fx = std::max(0.0f, std::min(x - x0, 1.0f));
  const float fy = std::max(0.0f, std::min(y - y0, 1.0f));
  for (int c = 0; c < 4; ++c) {
    const float v00 = lut[(static_cast<size_t>(y0) * res + x0) * 4 + c];
    const float v10 = lut[(static_cast<size_t>(y0) * res + x1) * 4 + c];
    const float v01 = lut[(static_cast<size_t>(y1) * res + x0) * 4 + c];
    const float v11 = lut[(static_cast<size_t>(y1) * res + x1) * 4 + c];
    out[c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) +
             (v01 * (1 - fx) + v11 * fx) * fy;
  }
}

int main(int argc, char **argv) {
  const int n = 64;
  const float step = argc > 1 ? 1.0f / atoi(argv[1]) : 1.0f / 64;
  const int lut_res = 512;
  Volume vol = make_slabs(n, 0.05f, 0.95f,
                          {{0.12f, 0.5f / n}, {0.30f, 1.0f / n},
                           {0.50f, 2.0f / n}, {0.70f, 4.0f / n},
                           {0.88f, 8.0f / n}});
  TransferFunc tf = default_transfer_func();
  std::vector<float> lut = tf.build_preint(lut_res, step, 256);

  // Ray for pixel (52,48) in a 64x64 image, angle 0.
  const float u = ((52.5f / 64) * 2 - 1) * 0.75f;
  const float v = ((48.5f / 64) * 2 - 1) * 0.75f;
  Vec3 ro{0.5f + u, 0.5f + v, 2.5f}, rd{0, 0, -1};

  float t0, t1;
  intersect_box(ro, rd, t0, t1);
  double C[3] = {0, 0, 0};
  double T = 1.0;
  float ti = t0;
  float sPrev = vol.sample(ro.x, ro.y, ro.z + rd.z * ti);
  int seg = 0;
  while (ti < t1 && T > 1e-5) {
    float tn = std::min(ti + step, t1);
    float segLen = tn - ti;
    float sCur = vol.sample(ro.x, ro.y, ro.z + rd.z * tn);
    float l[4];
    lut_sample(lut, lut_res, sPrev, sCur, l);
    float f = segLen / step;
    float tSeg = powf(std::max(l[3], 1e-12f), f);
    if (l[0] + l[1] + l[2] > 1e-6 || sPrev > 0.06 || sCur > 0.06) {
      // Exact integral over the same segment via fine quadrature.
      double ec[3] = {0, 0, 0}, et = 1.0;
      const int K = 4096;
      const double h = segLen / K;
      for (int k = 0; k < K; ++k) {
        const double t = ti + (k + 0.5) * h;
        const float s = vol.sample(ro.x, ro.y, ro.z + rd.z * t);
        float c[3], sigma;
        tf.eval(s, c, sigma);
        const double ts = exp(-(double)sigma * h);
        const double w = sigma > 1e-6f ? (1.0 - ts) / sigma : h;
        for (int ch = 0; ch < 3; ++ch) ec[ch] += et * c[ch] * w;
        et *= ts;
      }
      printf("seg %2d z=[%.5f,%.5f] s=[%.4f,%.4f] C=(%.5f,%.5f,%.5f) T=%.6f"
             " | exact C=(%.5f,%.5f,%.5f) T=%.6f\n",
             seg, ro.z + rd.z * ti, ro.z + rd.z * tn, sPrev, sCur,
             l[0] * f, l[1] * f, l[2] * f, tSeg, ec[0], ec[1], ec[2], et);
    }
    for (int c = 0; c < 3; ++c) C[c] += T * l[c] * f;
    T *= tSeg;
    sPrev = sCur;
    ti = tn;
    ++seg;
  }
  printf("emulated GPU: C=(%.8f,%.8f,%.8f) T=%.9g\n", C[0], C[1], C[2], T);
  RayResult ref = reference_integral(vol, tf, ro, rd, 1.0 / (n * 64.0));
  printf("reference   : C=(%.8f,%.8f,%.8f) T=%.9g\n", ref.r, ref.g, ref.b,
         ref.transmittance);
  return 0;
}
