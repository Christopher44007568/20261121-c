#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace oit::gl {

using GLenum = unsigned int;
using GLboolean = unsigned char;
using GLbitfield = unsigned int;
using GLbyte = signed char;
using GLubyte = unsigned char;
using GLshort = short;
using GLushort = unsigned short;
using GLint = int;
using GLuint = unsigned int;
using GLsizei = int;
using GLfloat = float;
using GLclampf = float;
using GLdouble = double;
using GLchar = char;
using GLintptr = std::ptrdiff_t;
using GLsizeiptr = std::ptrdiff_t;

constexpr GLenum GL_FALSE = 0;
constexpr GLenum GL_TRUE = 1;
constexpr GLenum GL_ZERO = 0;
constexpr GLenum GL_ONE = 1;
constexpr GLenum GL_TRIANGLES = 0x0004;
constexpr GLenum GL_DEPTH_BUFFER_BIT = 0x00000100;
constexpr GLenum GL_COLOR_BUFFER_BIT = 0x00004000;
constexpr GLenum GL_COLOR = 0x1800;
constexpr GLenum GL_LESS = 0x0201;
constexpr GLenum GL_LEQUAL = 0x0203;
constexpr GLenum GL_CULL_FACE = 0x0B44;
constexpr GLenum GL_DEPTH_TEST = 0x0B71;
constexpr GLenum GL_BLEND = 0x0BE2;
constexpr GLenum GL_BACK = 0x0405;
constexpr GLenum GL_CCW = 0x0901;
constexpr GLenum GL_UNPACK_ALIGNMENT = 0x0CF5;
constexpr GLenum GL_PACK_ALIGNMENT = 0x0D05;
constexpr GLenum GL_MAX_TEXTURE_SIZE = 0x0D33;
constexpr GLenum GL_SRC_ALPHA = 0x0302;
constexpr GLenum GL_ONE_MINUS_SRC_ALPHA = 0x0303;
constexpr GLenum GL_RED_INTEGER = 0x8D94;
constexpr GLenum GL_FLOAT = 0x1406;
constexpr GLenum GL_UNSIGNED_BYTE = 0x1401;
constexpr GLenum GL_UNSIGNED_INT = 0x1405;
constexpr GLenum GL_RGBA = 0x1908;
constexpr GLenum GL_RED = 0x1903;
constexpr GLenum GL_VERSION = 0x1F02;
constexpr GLenum GL_VENDOR = 0x1F00;
constexpr GLenum GL_RENDERER = 0x1F01;
constexpr GLenum GL_NEAREST = 0x2600;
constexpr GLenum GL_LINEAR = 0x2601;
constexpr GLenum GL_TEXTURE_MAG_FILTER = 0x2800;
constexpr GLenum GL_TEXTURE_MIN_FILTER = 0x2801;
constexpr GLenum GL_TEXTURE_WRAP_S = 0x2802;
constexpr GLenum GL_TEXTURE_WRAP_T = 0x2803;
constexpr GLenum GL_SRC1_ALPHA = 0x8589;
constexpr GLenum GL_FUNC_ADD = 0x8006;
constexpr GLenum GL_RGBA8 = 0x8058;
constexpr GLenum GL_RGBA16F = 0x881A;
constexpr GLenum GL_RGBA32F = 0x8814;
constexpr GLenum GL_R16F = 0x822D;
constexpr GLenum GL_R32F = 0x822E;
constexpr GLenum GL_R32UI = 0x8236;
constexpr GLenum GL_TEXTURE_2D = 0x0DE1;
constexpr GLenum GL_CLAMP_TO_EDGE = 0x812F;
constexpr GLenum GL_TEXTURE0 = 0x84C0;
constexpr GLenum GL_TEXTURE1 = 0x84C1;
constexpr GLenum GL_TEXTURE2 = 0x84C2;
constexpr GLenum GL_ARRAY_BUFFER = 0x8892;
constexpr GLenum GL_STATIC_DRAW = 0x88E4;
constexpr GLenum GL_DYNAMIC_DRAW = 0x88E8;
constexpr GLenum GL_FRAGMENT_SHADER = 0x8B30;
constexpr GLenum GL_VERTEX_SHADER = 0x8B31;
constexpr GLenum GL_COMPUTE_SHADER = 0x91B9;
constexpr GLenum GL_COMPILE_STATUS = 0x8B81;
constexpr GLenum GL_LINK_STATUS = 0x8B82;
constexpr GLenum GL_INFO_LOG_LENGTH = 0x8B84;
constexpr GLenum GL_FRAMEBUFFER = 0x8D40;
constexpr GLenum GL_COLOR_ATTACHMENT0 = 0x8CE0;
constexpr GLenum GL_COLOR_ATTACHMENT1 = 0x8CE1;
constexpr GLenum GL_COLOR_ATTACHMENT2 = 0x8CE2;
constexpr GLenum GL_COLOR_ATTACHMENT3 = 0x8CE3;
constexpr GLenum GL_DEPTH_ATTACHMENT = 0x8D00;
constexpr GLenum GL_FRAMEBUFFER_COMPLETE = 0x8CD5;
constexpr GLenum GL_READ_FRAMEBUFFER = 0x8CA8;
constexpr GLenum GL_DRAW_FRAMEBUFFER = 0x8CA9;
constexpr GLenum GL_READ_ONLY = 0x88B8;
constexpr GLenum GL_WRITE_ONLY = 0x88B9;
constexpr GLenum GL_READ_WRITE = 0x88BA;
constexpr GLenum GL_SHADER_STORAGE_BUFFER = 0x90D2;
constexpr GLenum GL_SHADER_IMAGE_ACCESS_BARRIER_BIT = 0x00000020;
constexpr GLenum GL_SHADER_STORAGE_BARRIER_BIT = 0x00000200;
constexpr GLenum GL_ALL_BARRIER_BITS = 0xFFFFFFFF;
constexpr GLenum GL_MAJOR_VERSION = 0x821B;
constexpr GLenum GL_MINOR_VERSION = 0x821C;
constexpr GLenum GL_NO_ERROR = 0;

struct GLFunctionTable;

#define OIT_GL_FUNCTION_LIST(X) \
    X(const GLubyte *, GetString, (GLenum name)) \
    X(void, GetIntegerv, (GLenum pname, GLint *data)) \
    X(GLenum, GetError, ()) \
    X(void, Viewport, (GLint x, GLint y, GLsizei width, GLsizei height)) \
    X(void, ClearColor, (GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha)) \
    X(void, Clear, (GLbitfield mask)) \
    X(void, ClearBufferfv, (GLenum buffer, GLint drawbuffer, const GLfloat *value)) \
    X(void, Enable, (GLenum cap)) \
    X(void, Enablei, (GLenum cap, GLuint index)) \
    X(void, Disable, (GLenum cap)) \
    X(void, DepthFunc, (GLenum func)) \
    X(void, DepthMask, (GLboolean flag)) \
    X(void, CullFace, (GLenum mode)) \
    X(void, FrontFace, (GLenum mode)) \
    X(void, BlendEquation, (GLenum mode)) \
    X(void, BlendFunc, (GLenum sfactor, GLenum dfactor)) \
    X(void, BlendFuncSeparate, (GLenum srcRGB, GLenum dstRGB, GLenum srcAlpha, GLenum dstAlpha)) \
    X(void, BlendFunci, (GLuint buf, GLenum sfactor, GLenum dfactor)) \
    X(void, BlendFuncSeparatei, (GLuint buf, GLenum srcRGB, GLenum dstRGB, GLenum srcAlpha, GLenum dstAlpha)) \
    X(void, DrawArrays, (GLenum mode, GLint first, GLsizei count)) \
    X(void, ReadPixels, (GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void *pixels)) \
    X(void, PixelStorei, (GLenum pname, GLint param)) \
    X(void, ReadBuffer, (GLenum src)) \
    X(void, Finish, ()) \
    X(void, GenTextures, (GLsizei n, GLuint *textures)) \
    X(void, DeleteTextures, (GLsizei n, const GLuint *textures)) \
    X(void, BindTexture, (GLenum target, GLuint texture)) \
    X(void, TexImage2D, (GLenum target, GLint level, GLint internalformat, GLsizei width, GLsizei height, GLint border, GLenum format, GLenum type, const void *pixels)) \
    X(void, TexStorage2D, (GLenum target, GLsizei levels, GLenum internalformat, GLsizei width, GLsizei height)) \
    X(void, TexParameteri, (GLenum target, GLenum pname, GLint param)) \
    X(void, ActiveTexture, (GLenum texture)) \
    X(void, ClearTexImage, (GLuint texture, GLint level, GLenum format, GLenum type, const void *data)) \
    X(void, BindImageTexture, (GLuint unit, GLuint texture, GLint level, GLboolean layered, GLint layer, GLenum access, GLenum format)) \
    X(void, GenFramebuffers, (GLsizei n, GLuint *framebuffers)) \
    X(void, DeleteFramebuffers, (GLsizei n, const GLuint *framebuffers)) \
    X(void, BindFramebuffer, (GLenum target, GLuint framebuffer)) \
    X(void, FramebufferTexture2D, (GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level)) \
    X(void, DrawBuffers, (GLsizei n, const GLenum *bufs)) \
    X(GLenum, CheckFramebufferStatus, (GLenum target)) \
    X(GLuint, CreateShader, (GLenum type)) \
    X(void, ShaderSource, (GLuint shader, GLsizei count, const GLchar *const *string, const GLint *length)) \
    X(void, CompileShader, (GLuint shader)) \
    X(void, GetShaderiv, (GLuint shader, GLenum pname, GLint *params)) \
    X(void, GetShaderInfoLog, (GLuint shader, GLsizei bufSize, GLsizei *length, GLchar *infoLog)) \
    X(GLuint, CreateProgram, ()) \
    X(void, AttachShader, (GLuint program, GLuint shader)) \
    X(void, LinkProgram, (GLuint program)) \
    X(void, GetProgramiv, (GLuint program, GLenum pname, GLint *params)) \
    X(void, GetProgramInfoLog, (GLuint program, GLsizei bufSize, GLsizei *length, GLchar *infoLog)) \
    X(void, DeleteShader, (GLuint shader)) \
    X(void, DeleteProgram, (GLuint program)) \
    X(void, UseProgram, (GLuint program)) \
    X(GLint, GetUniformLocation, (GLuint program, const GLchar *name)) \
    X(void, Uniform1i, (GLint location, GLint v0)) \
    X(void, Uniform1ui, (GLint location, GLuint v0)) \
    X(void, Uniform1f, (GLint location, GLfloat v0)) \
    X(void, Uniform2f, (GLint location, GLfloat v0, GLfloat v1)) \
    X(void, Uniform3f, (GLint location, GLfloat v0, GLfloat v1, GLfloat v2)) \
    X(void, Uniform4f, (GLint location, GLfloat v0, GLfloat v1, GLfloat v2, GLfloat v3)) \
    X(void, UniformMatrix4fv, (GLint location, GLsizei count, GLboolean transpose, const GLfloat *value)) \
    X(void, GenBuffers, (GLsizei n, GLuint *buffers)) \
    X(void, DeleteBuffers, (GLsizei n, const GLuint *buffers)) \
    X(void, BindBuffer, (GLenum target, GLuint buffer)) \
    X(void, BufferData, (GLenum target, GLsizeiptr size, const void *data, GLenum usage)) \
    X(void, BufferSubData, (GLenum target, GLintptr offset, GLsizeiptr size, const void *data)) \
    X(void, GetBufferSubData, (GLenum target, GLintptr offset, GLsizeiptr size, void *data)) \
    X(void, BindBufferBase, (GLenum target, GLuint index, GLuint buffer)) \
    X(void, GenVertexArrays, (GLsizei n, GLuint *arrays)) \
    X(void, DeleteVertexArrays, (GLsizei n, const GLuint *arrays)) \
    X(void, BindVertexArray, (GLuint array)) \
    X(void, EnableVertexAttribArray, (GLuint index)) \
    X(void, VertexAttribPointer, (GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void *pointer)) \
    X(void, DispatchCompute, (GLuint numGroupsX, GLuint numGroupsY, GLuint numGroupsZ)) \
    X(void, MemoryBarrier, (GLbitfield barriers))

#define OIT_GL_DECLARE(ret, name, params) \
    using PFN_##name = ret (*) params; \
    extern PFN_##name name;
OIT_GL_FUNCTION_LIST(OIT_GL_DECLARE)
#undef OIT_GL_DECLARE

bool load(void *(*getProcAddress)(const char *name), std::string *error);

}  // namespace oit::gl
