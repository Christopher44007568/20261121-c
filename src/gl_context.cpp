#include "gl_context.h"

bool GLContext::init(std::string *err) {
  dpy_ = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA,
                               EGL_DEFAULT_DISPLAY, nullptr);
  if (dpy_ == EGL_NO_DISPLAY) {
    dpy_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  }
  if (dpy_ == EGL_NO_DISPLAY) {
    *err = "eglGetDisplay failed";
    return false;
  }
  EGLint major = 0, minor = 0;
  if (!eglInitialize(dpy_, &major, &minor)) {
    *err = "eglInitialize failed";
    return false;
  }
  if (!eglBindAPI(EGL_OPENGL_API)) {
    *err = "eglBindAPI(EGL_OPENGL_API) failed";
    return false;
  }
  EGLint cfg_attribs[] = {EGL_SURFACE_TYPE, 0, EGL_RENDERABLE_TYPE,
                          EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig config = nullptr;
  EGLint num_config = 0;
  if (!eglChooseConfig(dpy_, cfg_attribs, &config, 1, &num_config) ||
      num_config < 1) {
    // Surfaceless needs no specific config; retry with empty attrib list.
    EGLint none_attribs[] = {EGL_NONE};
    if (!eglChooseConfig(dpy_, none_attribs, &config, 1, &num_config) ||
        num_config < 1) {
      *err = "eglChooseConfig failed";
      return false;
    }
  }
  EGLint ctx_attribs[] = {EGL_CONTEXT_MAJOR_VERSION, 3,
                          EGL_CONTEXT_MINOR_VERSION, 3,
                          EGL_CONTEXT_OPENGL_PROFILE_MASK,
                          EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
  ctx_ = eglCreateContext(dpy_, config, EGL_NO_CONTEXT, ctx_attribs);
  if (ctx_ == EGL_NO_CONTEXT) {
    *err = "eglCreateContext failed";
    return false;
  }
  if (!eglMakeCurrent(dpy_, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx_)) {
    *err = "eglMakeCurrent failed";
    return false;
  }
  if (!glmin_load()) {
    *err = "failed to load GL entry points";
    return false;
  }
  const GLubyte *r = glGetString(0x1F01); // GL_RENDERER
  renderer_ = r ? reinterpret_cast<const char *>(r) : "unknown";
  return true;
}

void GLContext::shutdown() {
  if (dpy_ != EGL_NO_DISPLAY) {
    eglMakeCurrent(dpy_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (ctx_ != EGL_NO_CONTEXT) eglDestroyContext(dpy_, ctx_);
    eglTerminate(dpy_);
  }
  dpy_ = EGL_NO_DISPLAY;
  ctx_ = EGL_NO_CONTEXT;
}
