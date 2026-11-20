#pragma once
#include "camera.h"
#include "glmin.h"
#include <string>
#include <vector>

enum class RenderMode { PostClassified = 0, PreIntegrated = 1 };

// GPU ray caster: orthographic rays through the unit cube, front-to-back
// emission/absorption compositing. Fragment shader supports classic
// post-classified sampling and pre-integrated transfer functions, plus
// stochastic ray-start jittering to suppress sampling-direction stripes.
class Renderer {
public:
  bool init(std::string *err);
  void set_volume(int n, const std::vector<float> &data);
  void set_tf_lut(const std::vector<float> &rgba, int res);
  void set_preint_lut(const std::vector<float> &rgba, int res);
  // Renders W x H floats RGBA: rgb = accumulated color, a = transmittance.
  // The pre-integrated LUT must have been built for `step`.
  std::vector<float> render(const Camera &cam, int w, int h, float step,
                            RenderMode mode, bool jitter, int seed = 0);

private:
  GLuint prog_ = 0;
  GLuint vao_ = 0;
  GLuint fbo_ = 0;
  GLuint color_tex_ = 0;
  GLuint vol_tex_ = 0;
  GLuint tf_tex_ = 0;
  GLuint preint_tex_ = 0;
  int fbo_w_ = 0, fbo_h_ = 0;
};
