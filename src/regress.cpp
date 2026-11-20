#include "regress.h"
#include "reference.h"
#include "transfer.h"
#include "volume.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace {

const int kLutRes = 512;
const int kPreintSubsteps = 256;
const float kUniformScalar = 0.15f;

struct Metrics {
  int n = 0;
  double max_rgb = 0, rmse_rgb = 0;
  double max_t = 0, rmse_t = 0;
};

struct CaseResult {
  std::string name;
  Metrics m;
};

std::vector<SlabDef> default_slabs(int n) {
  const float vox = 1.0f / n;
  return {
      {0.12f, 0.5f * vox}, {0.30f, 1.0f * vox}, {0.50f, 2.0f * vox},
      {0.70f, 4.0f * vox}, {0.88f, 8.0f * vox},
  };
}

Metrics compare(const std::vector<float> &img,
                const std::vector<RayResult> &ref, int w, int h,
                const std::string &csv_path) {
  Metrics m;
  double sum_rgb = 0, sum_t = 0;
  FILE *f = fopen(csv_path.c_str(), "w");
  if (f) {
    fprintf(f, "x,y,ref_r,ref_g,ref_b,ref_T,ren_r,ren_g,ren_b,ren_T,"
               "err_rgb,err_T\n");
  }
  for (int j = 0; j < h; ++j) {
    for (int i = 0; i < w; ++i) {
      const RayResult &r = ref[static_cast<size_t>(j) * w + i];
      if (!r.hit) continue;
      const float *px = &img[(static_cast<size_t>(j) * w + i) * 4];
      const double er = px[0] - r.r, eg = px[1] - r.g, eb = px[2] - r.b;
      const double et = px[3] - r.transmittance;
      const double e_rgb = std::max({std::fabs(er), std::fabs(eg),
                                     std::fabs(eb)});
      m.max_rgb = std::max(m.max_rgb, e_rgb);
      m.max_t = std::max(m.max_t, std::fabs(et));
      sum_rgb += er * er + eg * eg + eb * eb;
      sum_t += et * et;
      ++m.n;
      if (f) {
        fprintf(f, "%d,%d,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g\n",
                i, j, r.r, r.g, r.b, r.transmittance, px[0], px[1], px[2],
                px[3], e_rgb, std::fabs(et));
      }
    }
  }
  if (f) fclose(f);
  if (m.n > 0) {
    m.rmse_rgb = std::sqrt(sum_rgb / (3.0 * m.n));
    m.rmse_t = std::sqrt(sum_t / m.n);
  }
  return m;
}

std::vector<RayResult> reference_rays(const Volume &vol, const TransferFunc &tf,
                                      const Camera &cam, int w, int h,
                                      bool uniform) {
  std::vector<RayResult> out(static_cast<size_t>(w) * h);
  const double h_ref = 1.0 / (vol.n * 64.0);
  for (int j = 0; j < h; ++j) {
    for (int i = 0; i < w; ++i) {
      Vec3 ro, rd;
      cam.ray(i, j, w, h, ro, rd);
      if (uniform) {
        float t0, t1;
        if (intersect_box(ro, rd, t0, t1)) {
          out[static_cast<size_t>(j) * w + i] = reference_uniform_analytic(
              tf, kUniformScalar, static_cast<double>(t1) - t0);
        }
      } else {
        out[static_cast<size_t>(j) * w + i] =
            reference_integral(vol, tf, ro, rd, h_ref);
      }
    }
  }
  return out;
}

} // namespace

bool run_regression(Renderer &renderer, const std::string &outdir, int size) {
  const int n = 64;
  const TransferFunc tf = default_transfer_func();
  renderer.set_tf_lut(tf.build_lut1d(kLutRes), kLutRes);

  const Volume vol_uniform = make_uniform(n, kUniformScalar);
  const Volume vol_slabs = make_slabs(n, 0.05f, 0.95f, default_slabs(n));

  struct Config {
    const Volume *vol;
    std::string vname;
    bool uniform;
    RenderMode mode;
    float angle;
    float step;
    bool jitter;
  };
  std::vector<Config> configs;
  const float steps[] = {1.0f / 32, 1.0f / 64, 1.0f / 128, 1.0f / 256};
  for (float angle : {0.0f, 30.0f})
    for (float step : steps)
      for (RenderMode mode : {RenderMode::PostClassified,
                              RenderMode::PreIntegrated})
        configs.push_back({&vol_uniform, "uniform", true, mode, angle, step,
                           false});
  for (float angle : {0.0f, 30.0f, 45.0f})
    for (float step : steps)
      for (RenderMode mode : {RenderMode::PostClassified,
                              RenderMode::PreIntegrated})
        configs.push_back(
            {&vol_slabs, "slabs", false, mode, angle, step, false});
  configs.push_back(
      {&vol_slabs, "slabs", false, RenderMode::PreIntegrated, 45.0f,
       1.0f / 32, true});

  std::vector<CaseResult> results;
  char name[256];
  for (const Config &cfg : configs) {
    const char *mname =
        cfg.mode == RenderMode::PreIntegrated ? "preint" : "post";
    snprintf(name, sizeof(name), "%s_%s_a%03.0f_d%03d%s", cfg.vname.c_str(),
             mname, cfg.angle, static_cast<int>(std::round(1.0f / cfg.step)),
             cfg.jitter ? "_jitter" : "");
    renderer.set_volume(cfg.vol->n, cfg.vol->data);
    if (cfg.mode == RenderMode::PreIntegrated) {
      renderer.set_preint_lut(
          tf.build_preint(kLutRes, cfg.step, kPreintSubsteps), kLutRes);
    }
    const Camera cam = Camera::orbit(cfg.angle);
    std::vector<float> img =
        renderer.render(cam, size, size, cfg.step, cfg.mode, cfg.jitter);
    std::vector<RayResult> ref =
        reference_rays(*cfg.vol, tf, cam, size, size, cfg.uniform);
    Metrics m = compare(img, ref, size, size,
                        outdir + "/" + name + ".csv");
    results.push_back({name, m});
    printf("%-32s rays=%4d  max|dC|=%.3e  rmse(C)=%.3e  max|dT|=%.3e  "
           "rmse(T)=%.3e\n",
           name, m.n, m.max_rgb, m.rmse_rgb, m.max_t, m.rmse_t);
  }

  // Step-size consistency: consecutive halvings of the step should change
  // the image only slightly when pre-integration is used.
  printf("\nstep-size consistency (slabs, angle=30, max abs diff between "
         "consecutive step halvings):\n");
  renderer.set_volume(vol_slabs.n, vol_slabs.data);
  const Camera cam = Camera::orbit(30.0f);
  for (RenderMode mode : {RenderMode::PostClassified,
                          RenderMode::PreIntegrated}) {
    const float dsteps[] = {1.0f / 32, 1.0f / 64, 1.0f / 128, 1.0f / 256};
    std::vector<float> prev;
    printf("  %s:", mode == RenderMode::PreIntegrated ? "preint" : "post  ");
    for (float step : dsteps) {
      if (mode == RenderMode::PreIntegrated) {
        renderer.set_preint_lut(
            tf.build_preint(kLutRes, step, kPreintSubsteps), kLutRes);
      }
      std::vector<float> img =
          renderer.render(cam, size, size, step, mode, false);
      if (!prev.empty()) {
        double maxd = 0;
        for (size_t k = 0; k < img.size(); ++k)
          maxd = std::max(maxd,
                          std::fabs(static_cast<double>(img[k]) - prev[k]));
        printf("  d(1/%.0f)=%.3e", 1.0 / step, maxd);
      }
      prev = std::move(img);
    }
    printf("\n");
  }

  // Stripe coherence: without jitter, sampling-phase deviations form
  // bands along x (the sampling lattice is rotated against the image);
  // jitter decorrelates them into per-pixel noise. Reference for the
  // deviation is the Monte-Carlo mean of K independently seeded jittered
  // renders (removes geometric bias). Metric: standard deviation of
  // per-column mean signed transmittance deviation across columns.
  printf("\nstripe coherence (slabs, angle=20, preint, step=1/32):\n");
  {
    renderer.set_volume(vol_slabs.n, vol_slabs.data);
    renderer.set_preint_lut(
        tf.build_preint(kLutRes, 1.0f / 32, kPreintSubsteps), kLutRes);
    const Camera cam20 = Camera::orbit(20.0f);
    const int k = 16;
    std::vector<double> expect(static_cast<size_t>(size) * size, 0.0);
    for (int s = 1; s <= k; ++s) {
      std::vector<float> img = renderer.render(cam20, size, size, 1.0f / 32,
                                               RenderMode::PreIntegrated,
                                               true, s);
      for (size_t p = 0; p < expect.size(); ++p)
        expect[p] += img[p * 4 + 3] / k;
    }
    const Camera cam = cam20;
    for (int test = 0; test < 2; ++test) {
      const bool jitter = test == 1;
      std::vector<float> img =
          renderer.render(cam, size, size, 1.0f / 32,
                          RenderMode::PreIntegrated, jitter, 100);
      double band_var = 0, rmse = 0;
      int ncol = 0;
      for (int i = 0; i < size; ++i) {
        double col = 0;
        for (int j = 0; j < size; ++j) {
          const size_t p = static_cast<size_t>(j) * size + i;
          col += img[p * 4 + 3] - expect[p];
          rmse += (img[p * 4 + 3] - expect[p]) * (img[p * 4 + 3] - expect[p]);
        }
        band_var += col * col / (size * size);
        ++ncol;
      }
      band_var /= ncol;
      rmse /= static_cast<double>(size) * size;
      printf("  jitter=%d: band std of column-mean dev(T)=%.3e  "
             "rms dev(T)=%.3e\n",
             jitter ? 1 : 0, std::sqrt(band_var), std::sqrt(rmse));
    }
  }

  FILE *f = fopen((outdir + "/summary.csv").c_str(), "w");
  if (f) {
    fprintf(f, "case,rays,max_err_rgb,rmse_rgb,max_err_T,rmse_T\n");
    for (const CaseResult &r : results) {
      fprintf(f, "%s,%d,%.9g,%.9g,%.9g,%.9g\n", r.name.c_str(), r.m.n,
              r.m.max_rgb, r.m.rmse_rgb, r.m.max_t, r.m.rmse_t);
    }
    fclose(f);
  }
  return true;
}
