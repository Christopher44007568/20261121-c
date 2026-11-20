#include "gl_context.h"
#include "regress.h"
#include "renderer.h"
#include "transfer.h"
#include "volume.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

void usage() {
  printf("usage:\n");
  printf("  volview render [--volume uniform|slabs] [--mode post|preint]\n");
  printf("                 [--step 1/N] [--angle deg] [--size px]\n");
  printf("                 [--jitter 0|1] [--out image.ppm]\n");
  printf("  volview regress [--outdir dir] [--size px]\n");
}

float parse_step(const char *s) {
  // Accepts either a plain float ("0.02") or "1/N".
  const char *slash = strchr(s, '/');
  if (slash && slash[0] == '/' && slash != s && slash[-1] == '1') {
    return 1.0f / static_cast<float>(atof(slash + 1));
  }
  return static_cast<float>(atof(s));
}

bool write_ppm(const std::string &path, const std::vector<float> &img, int w,
               int h) {
  FILE *f = fopen(path.c_str(), "wb");
  if (!f) return false;
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  for (int j = h - 1; j >= 0; --j) { // flip vertically for viewing
    for (int i = 0; i < w; ++i) {
      const float *px = &img[(static_cast<size_t>(j) * w + i) * 4];
      for (int c = 0; c < 3; ++c) {
        float v = px[c];
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        fputc(static_cast<int>(v * 255.0f + 0.5f), f);
      }
    }
  }
  fclose(f);
  return true;
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 2) {
    usage();
    return 1;
  }
  std::string cmd = argv[1];

  GLContext gl;
  std::string err;
  if (!gl.init(&err)) {
    fprintf(stderr, "GL init failed: %s\n", err.c_str());
    return 1;
  }
  fprintf(stderr, "GL renderer: %s\n", gl.rendererString().c_str());

  Renderer renderer;
  if (!renderer.init(&err)) {
    fprintf(stderr, "renderer init failed: %s\n", err.c_str());
    return 1;
  }

  int rc = 0;
  if (cmd == "regress") {
    std::string outdir = "regression_out";
    int size = 64;
    for (int i = 2; i + 1 < argc; i += 2) {
      if (!strcmp(argv[i], "--outdir")) outdir = argv[i + 1];
      if (!strcmp(argv[i], "--size")) size = atoi(argv[i + 1]);
    }
    std::string mkdir_cmd = "mkdir -p " + outdir;
    if (system(mkdir_cmd.c_str()) != 0 || !run_regression(renderer, outdir, size)) {
      fprintf(stderr, "regression failed\n");
      rc = 1;
    }
  } else if (cmd == "render") {
    std::string volume = "slabs", mode = "preint", out = "render.ppm";
    float step = 1.0f / 64, angle = 30.0f;
    int size = 256, jitter = 1;
    for (int i = 2; i + 1 < argc; i += 2) {
      if (!strcmp(argv[i], "--volume")) volume = argv[i + 1];
      else if (!strcmp(argv[i], "--mode")) mode = argv[i + 1];
      else if (!strcmp(argv[i], "--step")) step = parse_step(argv[i + 1]);
      else if (!strcmp(argv[i], "--angle")) angle = atof(argv[i + 1]);
      else if (!strcmp(argv[i], "--size")) size = atoi(argv[i + 1]);
      else if (!strcmp(argv[i], "--jitter")) jitter = atoi(argv[i + 1]);
      else if (!strcmp(argv[i], "--out")) out = argv[i + 1];
    }
    const int n = 64;
    Volume vol = (volume == "uniform")
                     ? make_uniform(n, 0.15f)
                     : make_slabs(n, 0.05f, 0.95f,
                                  {{0.12f, 0.5f / n}, {0.30f, 1.0f / n},
                                   {0.50f, 2.0f / n}, {0.70f, 4.0f / n},
                                   {0.88f, 8.0f / n}});
    TransferFunc tf = default_transfer_func();
    renderer.set_volume(vol.n, vol.data);
    renderer.set_tf_lut(tf.build_lut1d(512), 512);
    RenderMode rm = (mode == "preint") ? RenderMode::PreIntegrated
                                       : RenderMode::PostClassified;
    if (rm == RenderMode::PreIntegrated) {
      renderer.set_preint_lut(tf.build_preint(512, step, 256), 512);
    }
    std::vector<float> img = renderer.render(Camera::orbit(angle), size, size,
                                             step, rm, jitter != 0);
    if (!write_ppm(out, img, size, size)) {
      fprintf(stderr, "cannot write %s\n", out.c_str());
      rc = 1;
    } else {
      printf("wrote %s\n", out.c_str());
    }
  } else {
    usage();
    rc = 1;
  }
  gl.shutdown();
  return rc;
}
