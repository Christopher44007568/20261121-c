#pragma once
// Minimal EGL + OpenGL 3.3 core declarations (no system GL headers required).
// Symbols are resolved at runtime via eglGetProcAddress / libEGL.

#include <stdint.h>
#include <stddef.h>

// ---------------- EGL ----------------
typedef void *EGLDisplay;
typedef void *EGLConfig;
typedef void *EGLContext;
typedef void *EGLSurface;
typedef int32_t EGLint;
typedef uint32_t EGLenum;
typedef uint32_t EGLBoolean;
typedef intptr_t EGLAttrib;

#define EGL_FALSE 0
#define EGL_TRUE 1
#define EGL_DEFAULT_DISPLAY ((void *)0)
#define EGL_NO_CONTEXT ((EGLContext)0)
#define EGL_NO_SURFACE ((EGLSurface)0)
#define EGL_NO_DISPLAY ((EGLDisplay)0)
#define EGL_NONE 0x3038
#define EGL_SURFACE_TYPE 0x3033
#define EGL_RENDERABLE_TYPE 0x3040
#define EGL_OPENGL_BIT 0x0008
#define EGL_OPENGL_API 0x30A2
#define EGL_CONTEXT_MAJOR_VERSION 0x3098
#define EGL_CONTEXT_MINOR_VERSION 0x30FB
#define EGL_CONTEXT_OPENGL_PROFILE_MASK 0x30FD
#define EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT 0x00000001
#define EGL_PLATFORM_SURFACELESS_MESA 0x31DD

extern "C" {
typedef void (*__eglMustCastToProperFunctionPointerType)(void);
EGLDisplay eglGetDisplay(void *display_id);
EGLDisplay eglGetPlatformDisplay(EGLenum platform, void *native_display,
                                 const EGLAttrib *attrib_list);
EGLBoolean eglInitialize(EGLDisplay dpy, EGLint *major, EGLint *minor);
EGLBoolean eglChooseConfig(EGLDisplay dpy, const EGLint *attrib_list,
                           EGLConfig *configs, EGLint config_size,
                           EGLint *num_config);
EGLBoolean eglBindAPI(EGLenum api);
EGLContext eglCreateContext(EGLDisplay dpy, EGLConfig config,
                            EGLContext share_context, const EGLint *attrib_list);
EGLBoolean eglMakeCurrent(EGLDisplay dpy, EGLSurface draw, EGLSurface read,
                          EGLContext ctx);
EGLint eglGetError(void);
EGLBoolean eglDestroyContext(EGLDisplay dpy, EGLContext ctx);
EGLBoolean eglTerminate(EGLDisplay dpy);
__eglMustCastToProperFunctionPointerType eglGetProcAddress(const char *procname);
}

// ---------------- GL types ----------------
typedef uint32_t GLenum;
typedef uint8_t GLboolean;
typedef uint32_t GLbitfield;
typedef int32_t GLint;
typedef int32_t GLsizei;
typedef uint32_t GLuint;
typedef uint8_t GLubyte;
typedef float GLfloat;
typedef char GLchar;
typedef ptrdiff_t GLsizeiptr;
typedef ptrdiff_t GLintptr;

#define GL_FALSE 0
#define GL_TRUE 1
#define GL_COLOR_BUFFER_BIT 0x00004000
#define GL_FLOAT 0x1406
#define GL_UNSIGNED_BYTE 0x1401
#define GL_RGB 0x1907
#define GL_RGBA 0x1908
#define GL_RED 0x1903
#define GL_NEAREST 0x2600
#define GL_LINEAR 0x2601
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE_3D 0x806F
#define GL_TEXTURE_WRAP_R 0x8072
#define GL_TEXTURE0 0x84C0
#define GL_R32F 0x822E
#define GL_RGBA32F 0x8814
#define GL_FRAMEBUFFER 0x8D40
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_VERTEX_SHADER 0x8B31
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_INFO_LOG_LENGTH 0x8B84
#define GL_TRIANGLES 0x0004

// ---------------- GL function pointers ----------------
#define GLFUN_LIST(X)                                                     \
  X(void, glClearColor, GLfloat, GLfloat, GLfloat, GLfloat)               \
  X(void, glClear, GLbitfield)                                            \
  X(void, glViewport, GLint, GLint, GLsizei, GLsizei)                     \
  X(void, glReadPixels, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum,   \
    void *)                                                               \
  X(void, glGenTextures, GLsizei, GLuint *)                               \
  X(void, glBindTexture, GLenum, GLuint)                                  \
  X(void, glTexParameteri, GLenum, GLenum, GLint)                         \
  X(void, glTexImage2D, GLenum, GLint, GLint, GLsizei, GLsizei, GLint,    \
    GLenum, GLenum, const void *)                                         \
  X(void, glTexImage3D, GLenum, GLint, GLint, GLsizei, GLsizei, GLsizei,  \
    GLint, GLenum, GLenum, const void *)                                  \
  X(void, glActiveTexture, GLenum)                                        \
  X(void, glGenFramebuffers, GLsizei, GLuint *)                           \
  X(void, glBindFramebuffer, GLenum, GLuint)                              \
  X(void, glFramebufferTexture2D, GLenum, GLenum, GLenum, GLuint, GLint)  \
  X(GLenum, glCheckFramebufferStatus, GLenum)                             \
  X(GLuint, glCreateShader, GLenum)                                       \
  X(void, glShaderSource, GLuint, GLsizei, const GLchar *const *,         \
    const GLint *)                                                        \
  X(void, glCompileShader, GLuint)                                        \
  X(void, glGetShaderiv, GLuint, GLenum, GLint *)                         \
  X(void, glGetShaderInfoLog, GLuint, GLsizei, GLsizei *, GLchar *)       \
  X(GLuint, glCreateProgram, void)                                        \
  X(void, glAttachShader, GLuint, GLuint)                                 \
  X(void, glLinkProgram, GLuint)                                          \
  X(void, glGetProgramiv, GLuint, GLenum, GLint *)                        \
  X(void, glGetProgramInfoLog, GLuint, GLsizei, GLsizei *, GLchar *)      \
  X(void, glUseProgram, GLuint)                                           \
  X(GLint, glGetUniformLocation, GLuint, const GLchar *)                  \
  X(void, glUniform1i, GLint, GLint)                                      \
  X(void, glUniform1f, GLint, GLfloat)                                    \
  X(void, glUniform2f, GLint, GLfloat, GLfloat)                           \
  X(void, glUniform3f, GLint, GLfloat, GLfloat, GLfloat)                  \
  X(void, glGenVertexArrays, GLsizei, GLuint *)                           \
  X(void, glBindVertexArray, GLuint)                                      \
  X(void, glDrawArrays, GLenum, GLint, GLsizei)                           \
  X(const GLubyte *, glGetString, GLenum)

#define GLFUN_DECLARE(ret, name, ...) extern ret (*name)(__VA_ARGS__);
GLFUN_LIST(GLFUN_DECLARE)
#undef GLFUN_DECLARE

// Loads all GL entry points. Returns false on failure.
bool glmin_load();
