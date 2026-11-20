#include "gl_context.h"
#include <cstdio>
#include <vector>

int main() {
  GLContext gl;
  std::string err;
  if (!gl.init(&err)) {
    fprintf(stderr, "GL init failed: %s\n", err.c_str());
    return 1;
  }
  printf("renderer: %s\n", gl.rendererString().c_str());
  GLuint fbo = 0, tex = 0;
  glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, 8, 8, 0, GL_RGBA, GL_FLOAT,
               nullptr);
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                         tex, 0);
  printf("fbo status: 0x%x\n", glCheckFramebufferStatus(GL_FRAMEBUFFER));
  glViewport(0, 0, 8, 8);
  glClearColor(0.25f, 0.5f, 0.75f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);
  std::vector<float> px(8 * 8 * 4);
  glReadPixels(0, 0, 8, 8, GL_RGBA, GL_FLOAT, px.data());
  printf("pixel[0]: %g %g %g %g\n", px[0], px[1], px[2], px[3]);
  gl.shutdown();
  return 0;
}
