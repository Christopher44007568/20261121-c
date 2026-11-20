#pragma once
#include "glmin.h"
#include <string>

// Headless OpenGL context via EGL surfaceless platform (Mesa/llvmpipe).
class GLContext {
public:
  bool init(std::string *err);
  void shutdown();
  const std::string &rendererString() const { return renderer_; }

private:
  EGLDisplay dpy_ = EGL_NO_DISPLAY;
  EGLContext ctx_ = EGL_NO_CONTEXT;
  std::string renderer_;
};
