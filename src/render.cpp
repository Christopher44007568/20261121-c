#include "render.hpp"

#include <epoxy/egl.h>
#include <epoxy/gl.h>

#include <algorithm>
#include <array>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#ifndef SHADER_DIR
#define SHADER_DIR "shaders"
#endif

namespace {

std::string readTextFile(const std::string& path) {
    std::ifstream stream(path);
    std::ostringstream contents;
    contents << stream.rdbuf();
    return contents.str();
}

uint32_t compileShader(GLenum type, const std::string& path, std::string& error) {
    const std::string source = readTextFile(path);
    if (source.empty()) {
        error = "cannot read shader: " + path;
        return 0;
    }
    const GLuint shader = glCreateShader(type);
    const char* sourcePointer = source.c_str();
    glShaderSource(shader, 1, &sourcePointer, nullptr);
    glCompileShader(shader);
    GLint ok = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (ok != GL_TRUE) {
        GLint length = 0;
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
        std::string log(static_cast<size_t>(std::max(length, 1)), '\0');
        glGetShaderInfoLog(shader, length, nullptr, log.data());
        error = "shader compile failed (" + path + "):\n" + log;
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

uint32_t linkProgram(const std::string& vertexPath, const std::string& fragmentPath,
                     std::string& error) {
    const uint32_t vertex = compileShader(GL_VERTEX_SHADER, vertexPath, error);
    if (vertex == 0) {
        return 0;
    }
    const uint32_t fragment = compileShader(GL_FRAGMENT_SHADER, fragmentPath, error);
    if (fragment == 0) {
        glDeleteShader(vertex);
        return 0;
    }
    const uint32_t program = glCreateProgram();
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    GLint ok = GL_FALSE;
    glGetProgramiv(program, GL_LINK_STATUS, &ok);
    if (ok != GL_TRUE) {
        GLint length = 0;
        glGetProgramiv(program, GL_INFO_LOG_LENGTH, &length);
        std::string log(static_cast<size_t>(std::max(length, 1)), '\0');
        glGetProgramInfoLog(program, length, nullptr, log.data());
        error = "program link failed (" + vertexPath + ", " + fragmentPath + "):\n" + log;
        glDeleteProgram(program);
        return 0;
    }
    return program;
}

void setMat4(uint32_t program, const char* name, const Mat4& matrix) {
    const int location = glGetUniformLocation(program, name);
    if (location >= 0) {
        glUniformMatrix4fv(location, 1, GL_FALSE, matrix.m.data());
    }
}

void setVec3(uint32_t program, const char* name, Vec3 value) {
    const int location = glGetUniformLocation(program, name);
    if (location >= 0) {
        glUniform3f(location, value.x, value.y, value.z);
    }
}

void setVec4(uint32_t program, const char* name, Vec4 value) {
    const int location = glGetUniformLocation(program, name);
    if (location >= 0) {
        glUniform4f(location, value.x, value.y, value.z, value.w);
    }
}

void appendEdge(std::vector<Vec3>& positions, Vec3 a, Vec3 b) {
    positions.push_back(a);
    positions.push_back(b);
}

}  // namespace

Mat4 Camera::view() const {
    return Mat4::lookAt(position, target, up);
}

Mat4 Camera::projection() const {
    return Mat4::perspective(radians(fovYDegrees), aspect, nearPlane, farPlane);
}

Mat4 Camera::viewProjection() const {
    return projection() * view();
}

Ray Camera::rayThroughPixel(int x, int y, int width, int height) const {
    const Vec3 forward = normalize(target - position);
    const Vec3 right = normalize(cross(forward, up));
    const Vec3 trueUp = normalize(cross(right, forward));
    const float tanHalf = std::tan(radians(fovYDegrees) * 0.5f);
    const float ndcX = (2.0f * (static_cast<float>(x) + 0.5f) / width) - 1.0f;
    const float ndcY = 1.0f - (2.0f * (static_cast<float>(y) + 0.5f) / height);
    const Vec3 direction = normalize(forward + right * (ndcX * tanHalf * aspect) +
                                     trueUp * (ndcY * tanHalf));
    return {position, direction};
}

PointLight PointLight::fromPhase(float phase) {
    PointLight light;
    light.phase = phase;
    light.position = {
        std::cos(phase) * light.orbitRadius,
        light.orbitHeight,
        std::sin(phase) * light.orbitRadius,
    };
    return light;
}

Scene buildDemoScene() {
    Scene scene;
    Mesh monolith = makeBox("monolith", {0.35f, 1.65f, -0.35f},
                            {0.85f, 1.65f, 0.55f}, {0.62f, 0.40f, 0.22f});
    Mesh orb = makeSphere("orb", {-2.15f, 1.12f, 1.02f}, 1.12f, 22, 40,
                          {0.10f, 0.48f, 0.56f});
    Mesh plinth = makeBox("plinth", {2.45f, 0.62f, 1.55f},
                          {0.58f, 0.62f, 0.58f}, {0.65f, 0.22f, 0.30f});
    scene.casters = {monolith, orb, plinth};
    scene.floor = makeFloor(scene.floorHalfExtent, scene.floorHalfExtent,
                            {0.30f, 0.33f, 0.35f});
    return scene;
}

Renderer::~Renderer() {
    destroyGlResources();
    if (eglDisplay_ != nullptr) {
        eglMakeCurrent(static_cast<EGLDisplay>(eglDisplay_), EGL_NO_SURFACE,
                       EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (eglContext_ != nullptr) {
            eglDestroyContext(static_cast<EGLDisplay>(eglDisplay_),
                              static_cast<EGLContext>(eglContext_));
        }
        if (eglSurface_ != nullptr) {
            eglDestroySurface(static_cast<EGLDisplay>(eglDisplay_),
                              static_cast<EGLSurface>(eglSurface_));
        }
        eglTerminate(static_cast<EGLDisplay>(eglDisplay_));
    }
}

bool Renderer::initialize(const Scene& scene, int width, int height, std::string& error) {
    width_ = width;
    height_ = height;
    scene_ = scene;
    if (!initializeEgl(error)) {
        return false;
    }
    if (!initializeFramebuffer(error)) {
        return false;
    }
    if (!initializePrograms(error)) {
        return false;
    }
    glGenVertexArrays(1, &emptyVao_);
    glGenVertexArrays(1, &shadowVao_);
    glGenBuffers(1, &shadowVbo_);
    glGenBuffers(1, &shadowEbo_);
    glBindVertexArray(shadowVao_);
    glBindBuffer(GL_ARRAY_BUFFER, shadowVbo_);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vec3), nullptr);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shadowEbo_);

    glGenVertexArrays(1, &lineVao_);
    glGenBuffers(1, &lineVbo_);
    glBindVertexArray(lineVao_);
    glBindBuffer(GL_ARRAY_BUFFER, lineVbo_);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vec3), nullptr);
    glBindVertexArray(0);

    uploadScene(scene);
    initialized_ = true;
    return true;
}

bool Renderer::initializeEgl(std::string& error) {
    EGLDisplay display = EGL_NO_DISPLAY;
    using GetPlatformDisplayExt = EGLDisplay (*)(EGLenum, void*, const EGLint*);
    const auto getPlatformDisplayExt =
        reinterpret_cast<GetPlatformDisplayExt>(eglGetProcAddress("eglGetPlatformDisplayEXT"));
    if (getPlatformDisplayExt != nullptr) {
        display = getPlatformDisplayExt(EGL_PLATFORM_SURFACELESS_MESA,
                                        EGL_DEFAULT_DISPLAY, nullptr);
    }
    if (display == EGL_NO_DISPLAY) {
        setenv("EGL_PLATFORM", "surfaceless", 1);
        display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    }
    if (display == EGL_NO_DISPLAY) {
        error = "eglGetDisplay failed";
        return false;
    }
    EGLint major = 0;
    EGLint minor = 0;
    if (!eglInitialize(display, &major, &minor)) {
        error = "eglInitialize failed";
        return false;
    }
    if (!eglBindAPI(EGL_OPENGL_API)) {
        error = "eglBindAPI(EGL_OPENGL_API) failed";
        return false;
    }

    const EGLint configAttributes[] = {
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 8,
        EGL_DEPTH_SIZE, 24,
        EGL_STENCIL_SIZE, 8,
        EGL_NONE,
    };
    EGLConfig config = nullptr;
    EGLint configCount = 0;
    if (!eglChooseConfig(display, configAttributes, &config, 1, &configCount) ||
        configCount == 0) {
        error = "eglChooseConfig failed";
        return false;
    }
    const EGLint surfaceAttributes[] = {
        EGL_WIDTH, width_,
        EGL_HEIGHT, height_,
        EGL_NONE,
    };
    EGLSurface surface = eglCreatePbufferSurface(display, config, surfaceAttributes);
    if (surface == EGL_NO_SURFACE) {
        error = "eglCreatePbufferSurface failed";
        return false;
    }
    const EGLint contextAttributes[] = {
        EGL_CONTEXT_MAJOR_VERSION, 4,
        EGL_CONTEXT_MINOR_VERSION, 5,
        EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
        EGL_NONE,
    };
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT,
                                          contextAttributes);
    if (context == EGL_NO_CONTEXT) {
        error = "eglCreateContext(OpenGL 4.5 core) failed";
        return false;
    }
    if (!eglMakeCurrent(display, surface, surface, context)) {
        error = "eglMakeCurrent failed";
        return false;
    }

    eglDisplay_ = display;
    eglSurface_ = surface;
    eglContext_ = context;
    const GLubyte* version = glGetString(GL_VERSION);
    const GLubyte* renderer = glGetString(GL_RENDERER);
    const GLubyte* glsl = glGetString(GL_SHADING_LANGUAGE_VERSION);
    glVersion_ = version ? reinterpret_cast<const char*>(version) : "";
    glRenderer_ = renderer ? reinterpret_cast<const char*>(renderer) : "";
    glslVersion_ = glsl ? reinterpret_cast<const char*>(glsl) : "";
    return true;
}

bool Renderer::initializeFramebuffer(std::string& error) {
    glGenTextures(1, &colorTexture_);
    glBindTexture(GL_TEXTURE_2D, colorTexture_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width_, height_, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    glGenRenderbuffers(1, &depthStencilBuffer_);
    glBindRenderbuffer(GL_RENDERBUFFER, depthStencilBuffer_);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width_, height_);

    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           colorTexture_, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT,
                              GL_RENDERBUFFER, depthStencilBuffer_);
    const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        error = "framebuffer incomplete: " + std::to_string(status);
        return false;
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return true;
}

bool Renderer::initializePrograms(std::string& error) {
    const std::string base = SHADER_DIR;
    sceneProgram_ = linkProgram(base + "/scene.vert", base + "/scene.frag", error);
    shadowProgram_ = linkProgram(base + "/shadow.vert", base + "/shadow.frag", error);
    skyProgram_ = linkProgram(base + "/sky.vert", base + "/sky.frag", error);
    overlayProgram_ = linkProgram(base + "/overlay.vert", base + "/overlay.frag", error);
    lineProgram_ = linkProgram(base + "/line.vert", base + "/line.frag", error);
    return sceneProgram_ != 0 && shadowProgram_ != 0 && skyProgram_ != 0 &&
           overlayProgram_ != 0 && lineProgram_ != 0;
}

void Renderer::uploadScene(const Scene& scene) {
    const auto uploadMesh = [](const Mesh& mesh, GpuMesh& gpu) {
        std::vector<float> vertexData;
        vertexData.reserve(mesh.vertices.size() * 6);
        for (const Vertex& vertex : mesh.vertices) {
            vertexData.insert(vertexData.end(), {
                vertex.position.x, vertex.position.y, vertex.position.z,
                vertex.normal.x, vertex.normal.y, vertex.normal.z,
            });
        }
        glGenVertexArrays(1, &gpu.vao);
        glGenBuffers(1, &gpu.vbo);
        glGenBuffers(1, &gpu.ebo);
        glBindVertexArray(gpu.vao);
        glBindBuffer(GL_ARRAY_BUFFER, gpu.vbo);
        glBufferData(GL_ARRAY_BUFFER,
                     static_cast<GLsizeiptr>(vertexData.size() * sizeof(float)),
                     vertexData.data(), GL_STATIC_DRAW);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, gpu.ebo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                     static_cast<GLsizeiptr>(mesh.indices.size() * sizeof(uint32_t)),
                     mesh.indices.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float), nullptr);
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float),
                              reinterpret_cast<const void*>(3 * sizeof(float)));
        gpu.indexCount = static_cast<int>(mesh.indices.size());
    };

    uploadMesh(scene.floor, floorGpu_);
    casterGpu_.resize(scene.casters.size());
    for (size_t i = 0; i < scene.casters.size(); ++i) {
        uploadMesh(scene.casters[i], casterGpu_[i]);
    }
    glBindVertexArray(0);
}

void Renderer::drawMesh(const GpuMesh& mesh) {
    glBindVertexArray(mesh.vao);
    glDrawElements(GL_TRIANGLES, mesh.indexCount, GL_UNSIGNED_INT, nullptr);
}

void Renderer::drawCastersShaded(const Camera& camera, const PointLight& light,
                                 bool depthEqual) {
    glUseProgram(sceneProgram_);
    setMat4(sceneProgram_, "uViewProjection", currentViewProjection_);
    setVec3(sceneProgram_, "uCameraPosition", camera.position);
    setVec3(sceneProgram_, "uLightPosition", light.position);
    setVec3(sceneProgram_, "uLightColor", light.color * light.intensity);
    glUniform1i(glGetUniformLocation(sceneProgram_, "uIsFloor"), 0);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(depthEqual ? GL_LEQUAL : GL_LESS);
    glDepthMask(GL_FALSE);
    glDisable(GL_STENCIL_TEST);
    glDisable(GL_BLEND);
    for (size_t i = 0; i < casterGpu_.size(); ++i) {
        setVec3(sceneProgram_, "uBaseColor", scene_.casters[i].color);
        drawMesh(casterGpu_[i]);
    }
}

void Renderer::drawFullscreen(uint32_t program, uint32_t targetFramebuffer,
                              int width, int height) {
    (void)width;
    (void)height;
    glBindFramebuffer(GL_FRAMEBUFFER, targetFramebuffer);
    glUseProgram(program);
    glBindVertexArray(emptyVao_);
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

void Renderer::uploadShadowVolume(const ShadowVolume& volume) {
    const size_t positionBytes = volume.positions.size() * sizeof(Vec3);
    glBindBuffer(GL_ARRAY_BUFFER, shadowVbo_);
    if (positionBytes > shadowVboCapacity_) {
        glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(positionBytes),
                     volume.positions.data(), GL_DYNAMIC_DRAW);
        shadowVboCapacity_ = positionBytes;
    } else {
        glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(positionBytes),
                        volume.positions.data());
    }

    std::vector<uint32_t> indices;
    indices.reserve(volume.indices());
    indices.insert(indices.end(), volume.frontCapIndices.begin(),
                   volume.frontCapIndices.end());
    indices.insert(indices.end(), volume.backCapIndices.begin(),
                   volume.backCapIndices.end());
    indices.insert(indices.end(), volume.sideIndices.begin(), volume.sideIndices.end());
    const size_t indexBytes = indices.size() * sizeof(uint32_t);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shadowEbo_);
    if (indexBytes > shadowEboCapacity_) {
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(indexBytes),
                     indices.data(), GL_DYNAMIC_DRAW);
        shadowEboCapacity_ = indexBytes;
    } else {
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(indexBytes),
                        indices.data());
    }

    glBindVertexArray(shadowVao_);
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indices.size()),
                   GL_UNSIGNED_INT, nullptr);
}

void Renderer::drawShadowVolumes(const Scene& scene, Vec3 lightPosition,
                                 const Mat4& viewProjection,
                                 const RenderOptions& options, RenderResult& result) {
    glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
    glDepthMask(GL_FALSE);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glEnable(GL_DEPTH_CLAMP);
    glDisable(GL_CULL_FACE);
    glEnable(GL_STENCIL_TEST);
    glStencilMask(0xFF);
    glStencilFunc(GL_ALWAYS, 0, 0xFF);
    glStencilOpSeparate(GL_FRONT, GL_KEEP, GL_DECR_WRAP, GL_KEEP);
    glStencilOpSeparate(GL_BACK, GL_KEEP, GL_INCR_WRAP, GL_KEEP);

    glUseProgram(shadowProgram_);
    setMat4(shadowProgram_, "uViewProjection", viewProjection);
    for (const Mesh& mesh : scene.casters) {
        const ShadowVolume volume = buildShadowVolume(mesh, lightPosition,
                                                      options.extrusionDistance);
        result.silhouetteEdgeCount += static_cast<int>(volume.silhouetteEdges.size());
        result.frontCapIndices += static_cast<int>(volume.frontCapIndices.size());
        result.backCapIndices += static_cast<int>(volume.backCapIndices.size());
        result.sideIndices += static_cast<int>(volume.sideIndices.size());
        result.nonManifoldEdges += volume.nonManifoldEdges;
        result.volumeTriangles += static_cast<int>(volume.indices() / 3);
        uploadShadowVolume(volume);
    }

    glDisable(GL_DEPTH_CLAMP);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glBindVertexArray(0);
}

RenderResult Renderer::render(const Camera& camera, const PointLight& light,
                              const RenderOptions& options) {
    RenderResult result;
    result.width = width_;
    result.height = height_;
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glViewport(0, 0, width_, height_);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);
    glDisable(GL_STENCIL_TEST);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glDepthMask(GL_TRUE);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glClearColor(0.01f, 0.015f, 0.025f, 1.0f);
    glClearStencil(0);
    glClearDepth(1.0);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);

    const Mat4 viewProjection = camera.viewProjection();
    currentViewProjection_ = viewProjection;
    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_FALSE);
    glUseProgram(skyProgram_);
    const int resolutionLocation = glGetUniformLocation(skyProgram_, "uResolution");
    if (resolutionLocation >= 0) {
        glUniform2f(resolutionLocation, static_cast<float>(width_),
                    static_cast<float>(height_));
    }
    glBindVertexArray(emptyVao_);
    glDrawArrays(GL_TRIANGLES, 0, 3);

    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glDepthMask(GL_TRUE);
    glUseProgram(sceneProgram_);
    setMat4(sceneProgram_, "uViewProjection", viewProjection);
    setVec3(sceneProgram_, "uCameraPosition", camera.position);
    setVec3(sceneProgram_, "uLightPosition", light.position);
    setVec3(sceneProgram_, "uLightColor", light.color * light.intensity);
    glUniform1i(glGetUniformLocation(sceneProgram_, "uIsFloor"), 1);
    setVec3(sceneProgram_, "uBaseColor", scene_.floor.color);
    drawMesh(floorGpu_);
    glUniform1i(glGetUniformLocation(sceneProgram_, "uIsFloor"), 0);
    for (size_t i = 0; i < casterGpu_.size(); ++i) {
        setVec3(sceneProgram_, "uBaseColor", scene_.casters[i].color);
        drawMesh(casterGpu_[i]);
    }

    drawShadowVolumes(scene_, light.position, viewProjection, options, result);

    glUseProgram(overlayProgram_);
    setVec4(overlayProgram_, "uColor", {0.48f, 0.54f, 0.68f, 1.0f});
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_GREATER);
    glDepthMask(GL_FALSE);
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_NOTEQUAL, 0, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
    glEnable(GL_BLEND);
    glBlendFunc(GL_ZERO, GL_SRC_COLOR);
    glBindVertexArray(emptyVao_);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glDisable(GL_BLEND);
    drawCastersShaded(camera, light, true);

    readColor(result.finalImage);
    if (options.drawEdges) {
        drawEdgeOverlay(scene_, light.position, options.drawVolumeWireframe);
        readColor(result.edgesImage);
    }
    if (options.captureDebug) {
        drawDebugOverlay();
        drawCastersShaded(camera, light, true);
        readColor(result.debugImage);
    }
    if (options.captureStencil) {
        readStencil(result.stencil);
    }

    glDisable(GL_STENCIL_TEST);
    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_TRUE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return result;
}

void Renderer::drawDebugOverlay() {
    glUseProgram(overlayProgram_);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_GREATER);
    glDepthMask(GL_FALSE);
    glEnable(GL_STENCIL_TEST);
    glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glBindVertexArray(emptyVao_);

    glStencilFunc(GL_NOTEQUAL, 0, 0xFF);
    setVec4(overlayProgram_, "uColor", {0.95f, 0.08f, 0.035f, 0.55f});
    glDrawArrays(GL_TRIANGLES, 0, 3);

    glStencilFunc(GL_EQUAL, 0, 0xFF);
    setVec4(overlayProgram_, "uColor", {0.05f, 0.78f, 0.30f, 0.20f});
    glDrawArrays(GL_TRIANGLES, 0, 3);

    glDisable(GL_BLEND);
    glDisable(GL_STENCIL_TEST);
}

void Renderer::drawEdgeOverlay(const Scene& scene, Vec3 lightPosition, bool volumeWireframe) {
    struct LineGroup {
        int first = 0;
        int count = 0;
        Vec4 color;
        float width = 1.0f;
    };
    std::vector<Vec3> points;
    std::vector<LineGroup> groups;

    const auto addGroup = [&](const std::vector<Vec3>& source, Vec4 color, float width) {
        const int first = static_cast<int>(points.size());
        points.insert(points.end(), source.begin(), source.end());
        groups.push_back({first, static_cast<int>(source.size()), color, width});
    };
    const auto appendTriangleEdges = [](std::vector<Vec3>& target,
                                        const std::vector<uint32_t>& indices,
                                        const std::vector<Vec3>& positions) {
        for (size_t i = 0; i + 2 < indices.size(); i += 3) {
            const Vec3 a = positions[indices[i + 0]];
            const Vec3 b = positions[indices[i + 1]];
            const Vec3 c = positions[indices[i + 2]];
            appendEdge(target, a, b);
            appendEdge(target, b, c);
            appendEdge(target, c, a);
        }
    };

    std::vector<Vec3> meshEdges;
    for (const Mesh& mesh : scene.casters) {
        for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
            appendEdge(meshEdges, mesh.vertices[mesh.indices[i + 0]].position,
                       mesh.vertices[mesh.indices[i + 1]].position);
            appendEdge(meshEdges, mesh.vertices[mesh.indices[i + 1]].position,
                       mesh.vertices[mesh.indices[i + 2]].position);
            appendEdge(meshEdges, mesh.vertices[mesh.indices[i + 2]].position,
                       mesh.vertices[mesh.indices[i + 0]].position);
        }
    }
    addGroup(meshEdges, {0.92f, 0.52f, 0.12f, 0.32f}, 1.0f);

    std::vector<Vec3> silhouette;
    std::vector<Vec3> volumeLines;
    for (const Mesh& mesh : scene.casters) {
        const ShadowVolume volume = buildShadowVolume(mesh, lightPosition, 8.0f);
        for (const SilhouetteEdge& edge : volume.silhouetteEdges) {
            const Vec3 a = volume.positions[edge.a];
            const Vec3 b = volume.positions[edge.b];
            appendEdge(silhouette, a, b);
            if (volumeWireframe) {
                const uint32_t n = static_cast<uint32_t>(mesh.vertices.size());
                appendEdge(volumeLines, a, volume.positions[n + edge.a]);
                appendEdge(volumeLines, b, volume.positions[n + edge.b]);
            }
        }
        if (volumeWireframe) {
            appendTriangleEdges(volumeLines, volume.sideIndices, volume.positions);
            appendTriangleEdges(volumeLines, volume.backCapIndices, volume.positions);
        }
    }
    addGroup(silhouette, {1.0f, 0.80f, 0.12f, 1.0f}, 2.0f);
    if (volumeWireframe && !volumeLines.empty()) {
        addGroup(volumeLines, {0.18f, 0.76f, 1.0f, 0.36f}, 1.0f);
    }

    glBindBuffer(GL_ARRAY_BUFFER, lineVbo_);
    const size_t bytes = points.size() * sizeof(Vec3);
    if (bytes > lineVboCapacity_) {
        glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(bytes), points.data(),
                     GL_DYNAMIC_DRAW);
        lineVboCapacity_ = bytes;
    } else {
        glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(bytes), points.data());
    }

    glUseProgram(lineProgram_);
    setMat4(lineProgram_, "uViewProjection", currentViewProjection_);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    glDepthMask(GL_FALSE);
    glDisable(GL_STENCIL_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glBindVertexArray(lineVao_);
    for (const LineGroup& group : groups) {
        setVec4(lineProgram_, "uColor", group.color);
        glLineWidth(group.width);
        glDrawArrays(GL_LINES, group.first, group.count);
    }
    glLineWidth(1.0f);
    glDisable(GL_BLEND);
    glDepthMask(GL_TRUE);
}

void Renderer::destroyGlResources() {
    if (initialized_) {
        for (GpuMesh& mesh : casterGpu_) {
            glDeleteBuffers(1, &mesh.vbo);
            glDeleteBuffers(1, &mesh.ebo);
            glDeleteVertexArrays(1, &mesh.vao);
        }
        casterGpu_.clear();
        if (floorGpu_.vao != 0) {
            glDeleteBuffers(1, &floorGpu_.vbo);
            glDeleteBuffers(1, &floorGpu_.ebo);
            glDeleteVertexArrays(1, &floorGpu_.vao);
        }
        if (shadowVao_ != 0) {
            glDeleteVertexArrays(1, &shadowVao_);
            glDeleteBuffers(1, &shadowVbo_);
            glDeleteBuffers(1, &shadowEbo_);
        }
        if (lineVao_ != 0) {
            glDeleteVertexArrays(1, &lineVao_);
            glDeleteBuffers(1, &lineVbo_);
        }
        if (emptyVao_ != 0) {
            glDeleteVertexArrays(1, &emptyVao_);
        }
        const uint32_t programs[] = {sceneProgram_, shadowProgram_, skyProgram_,
                                     overlayProgram_, lineProgram_};
        for (uint32_t program : programs) {
            if (program != 0) {
                glDeleteProgram(program);
            }
        }
        if (fbo_ != 0) {
            glDeleteFramebuffers(1, &fbo_);
        }
        if (colorTexture_ != 0) {
            glDeleteTextures(1, &colorTexture_);
        }
        if (depthStencilBuffer_ != 0) {
            glDeleteRenderbuffers(1, &depthStencilBuffer_);
        }
        initialized_ = false;
    }
}

void Renderer::readColor(ImageRgb& image) {
    std::vector<uint8_t> rgba(static_cast<size_t>(width_) * height_ * 4);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width_, height_, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
    image.width = width_;
    image.height = height_;
    image.pixels.resize(static_cast<size_t>(width_) * height_ * 3);
    for (int y = 0; y < height_; ++y) {
        const int sourceY = height_ - 1 - y;
        for (int x = 0; x < width_; ++x) {
            const size_t src = (static_cast<size_t>(sourceY) * width_ + x) * 4;
            const size_t dst = (static_cast<size_t>(y) * width_ + x) * 3;
            image.pixels[dst + 0] = rgba[src + 0];
            image.pixels[dst + 1] = rgba[src + 1];
            image.pixels[dst + 2] = rgba[src + 2];
        }
    }
}

void Renderer::readStencil(std::vector<uint8_t>& stencil) {
    std::vector<uint8_t> bottomUp(static_cast<size_t>(width_) * height_);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width_, height_, GL_STENCIL_INDEX, GL_UNSIGNED_BYTE,
                 bottomUp.data());
    stencil.resize(bottomUp.size());
    for (int y = 0; y < height_; ++y) {
        const int sourceY = height_ - 1 - y;
        std::memcpy(&stencil[static_cast<size_t>(y) * width_],
                    &bottomUp[static_cast<size_t>(sourceY) * width_],
                    static_cast<size_t>(width_));
    }
}
