#include "renderer.h"
#include "shaders.h"
#include <cstdio>

static GLuint compile_shader(GLenum type, const char *src, std::string *err) {
  GLuint sh = glCreateShader(type);
  glShaderSource(sh, 1, &src, nullptr);
  glCompileShader(sh);
  GLint ok = 0;
  glGetShaderiv(sh, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[4096];
    glGetShaderInfoLog(sh, sizeof(log), nullptr, log);
    *err = log;
    return 0;
  }
  return sh;
}

bool Renderer::init(std::string *err) {
  GLuint vs = compile_shader(GL_VERTEX_SHADER, kVertShader, err);
  if (!vs) return false;
  GLuint fs = compile_shader(GL_FRAGMENT_SHADER, kFragShader, err);
  if (!fs) return false;
  prog_ = glCreateProgram();
  glAttachShader(prog_, vs);
  glAttachShader(prog_, fs);
  glLinkProgram(prog_);
  GLint ok = 0;
  glGetProgramiv(prog_, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[4096];
    glGetProgramInfoLog(prog_, sizeof(log), nullptr, log);
    *err = log;
    return false;
  }
  glGenVertexArrays(1, &vao_);
  glGenTextures(1, &vol_tex_);
  glGenTextures(1, &tf_tex_);
  glGenTextures(1, &preint_tex_);
  glGenTextures(1, &color_tex_);
  glGenFramebuffers(1, &fbo_);
  return true;
}

void Renderer::set_volume(int n, const std::vector<float> &data) {
  glBindTexture(GL_TEXTURE_3D, vol_tex_);
  glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
  glTexImage3D(GL_TEXTURE_3D, 0, GL_R32F, n, n, n, 0, GL_RED, GL_FLOAT,
               data.data());
}

void Renderer::set_tf_lut(const std::vector<float> &rgba, int res) {
  glBindTexture(GL_TEXTURE_2D, tf_tex_);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, res, 1, 0, GL_RGBA, GL_FLOAT,
               rgba.data());
}

void Renderer::set_preint_lut(const std::vector<float> &rgba, int res) {
  glBindTexture(GL_TEXTURE_2D, preint_tex_);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, res, res, 0, GL_RGBA, GL_FLOAT,
               rgba.data());
}

std::vector<float> Renderer::render(const Camera &cam, int w, int h,
                                    float step, RenderMode mode, bool jitter,
                                    int seed) {
  if (w != fbo_w_ || h != fbo_h_) {
    glBindTexture(GL_TEXTURE_2D, color_tex_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, w, h, 0, GL_RGBA, GL_FLOAT,
                 nullptr);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           color_tex_, 0);
    fbo_w_ = w;
    fbo_h_ = h;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
  glViewport(0, 0, w, h);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT);

  glUseProgram(prog_);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_3D, vol_tex_);
  glActiveTexture(GL_TEXTURE0 + 1);
  glBindTexture(GL_TEXTURE_2D, tf_tex_);
  glActiveTexture(GL_TEXTURE0 + 2);
  glBindTexture(GL_TEXTURE_2D, preint_tex_);
  glUniform1i(glGetUniformLocation(prog_, "volTex"), 0);
  glUniform1i(glGetUniformLocation(prog_, "tfLut"), 1);
  glUniform1i(glGetUniformLocation(prog_, "preintLut"), 2);
  glUniform3f(glGetUniformLocation(prog_, "eye"), cam.eye.x, cam.eye.y,
              cam.eye.z);
  glUniform3f(glGetUniformLocation(prog_, "camRight"), cam.right.x,
              cam.right.y, cam.right.z);
  glUniform3f(glGetUniformLocation(prog_, "camUp"), cam.up.x, cam.up.y,
              cam.up.z);
  glUniform3f(glGetUniformLocation(prog_, "camForward"), cam.forward.x,
              cam.forward.y, cam.forward.z);
  glUniform2f(glGetUniformLocation(prog_, "halfSize"), cam.half_w, cam.half_h);
  glUniform2f(glGetUniformLocation(prog_, "resolution"),
              static_cast<float>(w), static_cast<float>(h));
  glUniform1f(glGetUniformLocation(prog_, "stepSize"), step);
  glUniform1i(glGetUniformLocation(prog_, "mode"), static_cast<int>(mode));
  glUniform1i(glGetUniformLocation(prog_, "jitterOn"), jitter ? 1 : 0);
  glUniform1i(glGetUniformLocation(prog_, "frameSeed"), seed);

  glBindVertexArray(vao_);
  glDrawArrays(GL_TRIANGLES, 0, 3);

  std::vector<float> out(static_cast<size_t>(w) * h * 4);
  glReadPixels(0, 0, w, h, GL_RGBA, GL_FLOAT, out.data());
  return out;
}
