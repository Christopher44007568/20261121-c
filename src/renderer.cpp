#include "renderer.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <initializer_list>
#include <sstream>
#include <string>
#include <vector>

namespace oit {

namespace {

constexpr int kReferenceMaxWidth = 256;
constexpr int kReferenceMaxHeight = 192;
constexpr gl::GLuint kReferenceCapacity = 96;
constexpr std::size_t kReferenceNodeBytes = 16;

std::string shaderPath(const char *name) {
    return std::string(OIT_SHADER_DIR) + "/" + name;
}

std::string readTextFile(const std::string &path, std::string *error) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        if (error) *error = "Could not open shader: " + path;
        return {};
    }
    std::ostringstream stream;
    stream << file.rdbuf();
    return stream.str();
}

gl::GLuint makeTexture(gl::GLenum internalFormat, gl::GLenum format, gl::GLenum type,
                       int width, int height, bool linear) {
    gl::GLuint texture = 0;
    gl::GenTextures(1, &texture);
    gl::BindTexture(gl::GL_TEXTURE_2D, texture);
    gl::TexImage2D(gl::GL_TEXTURE_2D, 0, static_cast<gl::GLint>(internalFormat), width, height,
                   0, format, type, nullptr);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MIN_FILTER,
                      linear ? gl::GL_LINEAR : gl::GL_NEAREST);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MAG_FILTER,
                      linear ? gl::GL_LINEAR : gl::GL_NEAREST);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_WRAP_S, gl::GL_CLAMP_TO_EDGE);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_WRAP_T, gl::GL_CLAMP_TO_EDGE);
    gl::BindTexture(gl::GL_TEXTURE_2D, 0);
    return texture;
}

gl::GLuint attachColorTexture(gl::GLuint fbo, gl::GLuint texture, gl::GLenum attachment) {
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, fbo);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, attachment, gl::GL_TEXTURE_2D, texture, 0);
    return fbo;
}

}  // namespace

const char *sceneName(ScenePreset scene) {
    switch (scene) {
        case ScenePreset::NearOpaque:
            return "NEAR OPAQUE";
        case ScenePreset::Multilayer:
            return "MULTILAYER LOW ALPHA";
        default:
            return "UNKNOWN";
    }
}

const char *viewName(ViewMode view) {
    switch (view) {
        case ViewMode::Wboit:
            return "WBOIT";
        case ViewMode::Reference:
            return "PIXEL SORTS";
        case ViewMode::Error:
            return "ERROR MAP";
        case ViewMode::Compare:
            return "COMPARE";
        default:
            return "UNKNOWN";
    }
}

const char *orderName(DrawOrder order) {
    return order == DrawOrder::Forward ? "A B C D" : "D C B A";
}

Renderer::~Renderer() {
    release();
}

gl::GLuint Renderer::compileShaderFromFile(gl::GLenum type, const char *path,
                                            std::string *error) {
    const std::string source = readTextFile(shaderPath(path), error);
    if (source.empty()) return 0;
    const char *sourcePtr = source.c_str();
    const gl::GLuint shader = gl::CreateShader(type);
    gl::ShaderSource(shader, 1, &sourcePtr, nullptr);
    gl::CompileShader(shader);
    gl::GLint compiled = 0;
    gl::GetShaderiv(shader, gl::GL_COMPILE_STATUS, &compiled);
    if (!compiled) {
        gl::GLint logLength = 0;
        gl::GetShaderiv(shader, gl::GL_INFO_LOG_LENGTH, &logLength);
        std::vector<char> log(static_cast<std::size_t>(std::max(1, logLength)));
        gl::GetShaderInfoLog(shader, static_cast<gl::GLsizei>(log.size()), nullptr, log.data());
        if (error) *error = std::string(path) + " compile failed:\n" + log.data();
        gl::DeleteShader(shader);
        return 0;
    }
    return shader;
}

gl::GLuint Renderer::loadProgram(const char *vertexPath, const char *fragmentPath,
                                 std::string *error) {
    const gl::GLuint vertex = compileShaderFromFile(gl::GL_VERTEX_SHADER, vertexPath, error);
    if (!vertex) return 0;
    const gl::GLuint fragment =
        compileShaderFromFile(gl::GL_FRAGMENT_SHADER, fragmentPath, error);
    if (!fragment) {
        gl::DeleteShader(vertex);
        return 0;
    }
    const gl::GLuint program = gl::CreateProgram();
    gl::AttachShader(program, vertex);
    gl::AttachShader(program, fragment);
    gl::LinkProgram(program);
    gl::DeleteShader(vertex);
    gl::DeleteShader(fragment);
    gl::GLint linked = 0;
    gl::GetProgramiv(program, gl::GL_LINK_STATUS, &linked);
    if (!linked) {
        gl::GLint logLength = 0;
        gl::GetProgramiv(program, gl::GL_INFO_LOG_LENGTH, &logLength);
        std::vector<char> log(static_cast<std::size_t>(std::max(1, logLength)));
        gl::GetProgramInfoLog(program, static_cast<gl::GLsizei>(log.size()), nullptr, log.data());
        if (error) *error = std::string(vertexPath) + " link failed:\n" + log.data();
        gl::DeleteProgram(program);
        return 0;
    }
    return program;
}

gl::GLuint Renderer::loadComputeProgram(const char *path, std::string *error) {
    const gl::GLuint shader = compileShaderFromFile(gl::GL_COMPUTE_SHADER, path, error);
    if (!shader) return 0;
    const gl::GLuint program = gl::CreateProgram();
    gl::AttachShader(program, shader);
    gl::LinkProgram(program);
    gl::DeleteShader(shader);
    gl::GLint linked = 0;
    gl::GetProgramiv(program, gl::GL_LINK_STATUS, &linked);
    if (!linked) {
        gl::GLint logLength = 0;
        gl::GetProgramiv(program, gl::GL_INFO_LOG_LENGTH, &logLength);
        std::vector<char> log(static_cast<std::size_t>(std::max(1, logLength)));
        gl::GetProgramInfoLog(program, static_cast<gl::GLsizei>(log.size()), nullptr, log.data());
        if (error) *error = std::string(path) + " link failed:\n" + log.data();
        gl::DeleteProgram(program);
        return 0;
    }
    return program;
}

bool Renderer::init(std::string *error) {
    wboitProgram_ = loadProgram("tube.vert", "wboit.frag", error);
    if (!wboitProgram_) return false;
    resolveProgram_ = loadProgram("fullscreen.vert", "resolve.frag", error);
    if (!resolveProgram_) return false;
    displayProgram_ = loadProgram("fullscreen.vert", "display.frag", error);
    if (!displayProgram_) return false;
    referenceProgram_ = loadProgram("tube.vert", "reference.frag", error);
    if (!referenceProgram_) return false;
    referenceResolveProgram_ =
        loadComputeProgram("reference_resolve.comp", error);
    if (!referenceResolveProgram_) return false;
    errorProgram_ = loadComputeProgram("error.comp", error);
    if (!errorProgram_) return false;

    gl::GenVertexArrays(1, &fullscreenVao_);
    rebuildScene();
    return true;
}

void Renderer::release() {
    destroySizedResources();
    for (Mesh &mesh : meshes_) {
        if (mesh.vbo) gl::DeleteBuffers(1, &mesh.vbo);
        if (mesh.vao) gl::DeleteVertexArrays(1, &mesh.vao);
    }
    meshes_.clear();
    if (fullscreenVao_) gl::DeleteVertexArrays(1, &fullscreenVao_);
    if (wboitProgram_) gl::DeleteProgram(wboitProgram_);
    if (resolveProgram_) gl::DeleteProgram(resolveProgram_);
    if (displayProgram_) gl::DeleteProgram(displayProgram_);
    if (referenceProgram_) gl::DeleteProgram(referenceProgram_);
    if (referenceResolveProgram_) gl::DeleteProgram(referenceResolveProgram_);
    if (errorProgram_) gl::DeleteProgram(errorProgram_);
    fullscreenVao_ = 0;
    wboitProgram_ = resolveProgram_ = displayProgram_ = 0;
    referenceProgram_ = referenceResolveProgram_ = errorProgram_ = 0;
}

Vec3 Renderer::bundleAxis(int index, ScenePreset scene) {
    static const Vec3 nearAxes[] = {
        {1.0f, 0.05f, 0.22f},
        {0.03f, 1.0f, 0.14f},
        {0.20f, 0.12f, 1.0f},
    };
    static const Vec3 multilayerAxes[] = {
        {1.0f, 0.08f, 0.26f},
        {0.10f, 1.0f, 0.20f},
        {0.22f, 0.14f, 1.0f},
        {1.0f, 0.72f, 1.0f},
    };
    const Vec3 *axes = scene == ScenePreset::NearOpaque ? nearAxes : multilayerAxes;
    return normalize(axes[index]);
}

void Renderer::setScene(ScenePreset scene) {
    if (scene == scene_) return;
    scene_ = scene;
    rebuildScene();
}

void Renderer::setDrawOrder(DrawOrder order) {
    if (order == drawOrder_) return;
    drawOrder_ = order;
    referenceDirty_ = true;
}

void Renderer::toggleDrawOrder() {
    setDrawOrder(drawOrder_ == DrawOrder::Forward ? DrawOrder::Reverse : DrawOrder::Forward);
}

void Renderer::rebuildScene() {
    for (Mesh &mesh : meshes_) {
        if (mesh.vbo) gl::DeleteBuffers(1, &mesh.vbo);
        if (mesh.vao) gl::DeleteVertexArrays(1, &mesh.vao);
    }
    meshes_.clear();
    orderWboitCache_[0].clear();
    orderWboitCache_[1].clear();
    orderReferenceCache_[0].clear();
    orderReferenceCache_[1].clear();

    const bool nearOpaque = scene_ == ScenePreset::NearOpaque;
    const int bundleCount = nearOpaque ? 3 : 4;
    const int tubesPerBundle = nearOpaque ? 12 : 10;
    const Vec3 colors[] = {
        {0.06f, 0.74f, 0.86f},
        {0.96f, 0.42f, 0.13f},
        {0.78f, 0.20f, 0.72f},
        {0.42f, 0.82f, 0.28f},
    };
    const Vec3 centers[] = {
        {-0.16f, 0.10f, 0.04f},
        {0.16f, -0.14f, -0.06f},
        {-0.08f, 0.02f, 0.18f},
        {0.10f, 0.06f, -0.17f},
    };

    sceneInfo_.bundles = bundleCount;
    sceneInfo_.tubesPerBundle = tubesPerBundle;
    sceneInfo_.totalTubes = bundleCount * tubesPerBundle;
    sceneInfo_.alpha = nearOpaque ? 0.94f : 0.16f;
    meshes_.resize(static_cast<std::size_t>(bundleCount));
    for (int bundle = 0; bundle < bundleCount; ++bundle) {
        buildBundleMesh(bundle, bundleAxis(bundle, scene_), centers[bundle], &meshes_);
        meshes_[static_cast<std::size_t>(bundle)].color = colors[bundle];
    }
    referenceDirty_ = true;
    metrics_ = RenderMetrics{};
}

void Renderer::buildBundleMesh(int bundleIndex, Vec3 axis, Vec3 center,
                               std::vector<Mesh> *meshes) {
    const float halfLength = 3.15f;
    const float radius = 0.088f;
    const int segments = 18;
    const int tubes = sceneInfo_.tubesPerBundle;
    const int columns = tubes >= 12 ? 4 : 5;
    const int rows = (tubes + columns - 1) / columns;
    const float spacing = 0.175f;

    Vec3 reference = std::abs(axis.y) < 0.9f ? Vec3{0.0f, 1.0f, 0.0f}
                                              : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 u = normalize(cross(axis, reference));
    const Vec3 v = cross(axis, u);

    struct Vertex {
        float position[3];
        float normal[3];
    };
    std::vector<Vertex> vertices;
    vertices.reserve(static_cast<std::size_t>(tubes * segments * 6));

    for (int tube = 0; tube < tubes; ++tube) {
        const int column = tube % columns;
        const int row = tube / columns;
        const float offsetU = (static_cast<float>(column) - (columns - 1) * 0.5f) * spacing;
        const float offsetV = (static_cast<float>(row) - (rows - 1) * 0.5f) * spacing;
        const Vec3 tubeCenter = center + u * offsetU + v * offsetV;
        const Vec3 a = tubeCenter - axis * halfLength;
        const Vec3 b = tubeCenter + axis * halfLength;

        for (int segment = 0; segment < segments; ++segment) {
            const float angle0 = 2.0f * kPi * static_cast<float>(segment) /
                                 static_cast<float>(segments);
            const float angle1 = 2.0f * kPi * static_cast<float>(segment + 1) /
                                 static_cast<float>(segments);
            const Vec3 n0 = u * std::cos(angle0) + v * std::sin(angle0);
            const Vec3 n1 = u * std::cos(angle1) + v * std::sin(angle1);
            const Vec3 a0 = a + n0 * radius;
            const Vec3 b0 = b + n0 * radius;
            const Vec3 a1 = a + n1 * radius;
            const Vec3 b1 = b + n1 * radius;
            const auto add = [&vertices](Vec3 p, Vec3 n) {
                vertices.push_back(Vertex{{p.x, p.y, p.z}, {n.x, n.y, n.z}});
            };
            add(a0, n0);
            add(b0, n0);
            add(b1, n1);
            add(a0, n0);
            add(b1, n1);
            add(a1, n1);
        }
    }

    Mesh &mesh = (*meshes)[static_cast<std::size_t>(bundleIndex)];
    gl::GenVertexArrays(1, &mesh.vao);
    gl::GenBuffers(1, &mesh.vbo);
    gl::BindVertexArray(mesh.vao);
    gl::BindBuffer(gl::GL_ARRAY_BUFFER, mesh.vbo);
    gl::BufferData(gl::GL_ARRAY_BUFFER,
                   static_cast<gl::GLsizeiptr>(vertices.size() * sizeof(Vertex)),
                   vertices.data(), gl::GL_STATIC_DRAW);
    gl::EnableVertexAttribArray(0);
    gl::VertexAttribPointer(0, 3, gl::GL_FLOAT, gl::GL_FALSE, sizeof(Vertex),
                            reinterpret_cast<const void *>(offsetof(Vertex, position)));
    gl::EnableVertexAttribArray(1);
    gl::VertexAttribPointer(1, 3, gl::GL_FLOAT, gl::GL_FALSE, sizeof(Vertex),
                            reinterpret_cast<const void *>(offsetof(Vertex, normal)));
    gl::BindVertexArray(0);
    mesh.vertexCount = static_cast<int>(vertices.size());
}

void Renderer::ensureResources(int width, int height) {
    width = std::max(1, width);
    height = std::max(1, height);
    if (width == width_ && height == height_ && mainFbo_ != 0) return;

    destroySizedResources();
    width_ = width;
    height_ = height;
    refWidth_ = std::min(kReferenceMaxWidth, std::max(64, width_ / 4));
    refHeight_ = static_cast<int>(std::lround(
        static_cast<double>(refWidth_) * static_cast<double>(height_) /
        static_cast<double>(width_)));
    refHeight_ = std::clamp(refHeight_, 1, kReferenceMaxHeight);

    mainAccum_ = makeTexture(gl::GL_RGBA16F, gl::GL_RGBA, gl::GL_FLOAT, width_, height_, false);
    mainReveal_ = makeTexture(gl::GL_R16F, gl::GL_RED, gl::GL_FLOAT, width_, height_, false);
    mainColor_ = makeTexture(gl::GL_RGBA8, gl::GL_RGBA, gl::GL_UNSIGNED_BYTE,
                             width_, height_, false);
    gl::GenFramebuffers(1, &mainFbo_);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, mainFbo_);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, gl::GL_COLOR_ATTACHMENT0,
                             gl::GL_TEXTURE_2D, mainAccum_, 0);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, gl::GL_COLOR_ATTACHMENT1,
                             gl::GL_TEXTURE_2D, mainReveal_, 0);
    const gl::GLenum mainAttachments[] = {gl::GL_COLOR_ATTACHMENT0,
                                          gl::GL_COLOR_ATTACHMENT1};
    gl::DrawBuffers(2, mainAttachments);
    gl::GenFramebuffers(1, &mainResolveFbo_);
    attachColorTexture(mainResolveFbo_, mainColor_, gl::GL_COLOR_ATTACHMENT0);

    lowAccum_ = makeTexture(gl::GL_RGBA16F, gl::GL_RGBA, gl::GL_FLOAT,
                            refWidth_, refHeight_, false);
    lowReveal_ = makeTexture(gl::GL_R16F, gl::GL_RED, gl::GL_FLOAT,
                             refWidth_, refHeight_, false);
    lowColor_ = makeTexture(gl::GL_RGBA16F, gl::GL_RGBA, gl::GL_FLOAT,
                            refWidth_, refHeight_, false);
    gl::GenFramebuffers(1, &lowFbo_);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, lowFbo_);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, gl::GL_COLOR_ATTACHMENT0,
                             gl::GL_TEXTURE_2D, lowAccum_, 0);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, gl::GL_COLOR_ATTACHMENT1,
                             gl::GL_TEXTURE_2D, lowReveal_, 0);
    gl::DrawBuffers(2, mainAttachments);
    gl::GenFramebuffers(1, &lowResolveFbo_);
    attachColorTexture(lowResolveFbo_, lowColor_, gl::GL_COLOR_ATTACHMENT0);

    refHeads_ = makeTexture(gl::GL_R32UI, gl::GL_RED_INTEGER, gl::GL_UNSIGNED_INT,
                            refWidth_, refHeight_, false);
    refColor_ = makeTexture(gl::GL_RGBA16F, gl::GL_RGBA, gl::GL_FLOAT,
                            refWidth_, refHeight_, false);
    gl::GenFramebuffers(1, &refFbo_);
    attachColorTexture(refFbo_, refColor_, gl::GL_COLOR_ATTACHMENT0);
    errorTexture_ = makeTexture(gl::GL_R16F, gl::GL_RED, gl::GL_FLOAT,
                                refWidth_, refHeight_, false);
    gl::GenFramebuffers(1, &errorFbo_);
    attachColorTexture(errorFbo_, errorTexture_, gl::GL_COLOR_ATTACHMENT0);

    gl::GenBuffers(1, &refCounterBuffer_);
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, refCounterBuffer_);
    const gl::GLuint counterData[2] = {0u, 0u};
    gl::BufferData(gl::GL_SHADER_STORAGE_BUFFER, sizeof(counterData), counterData,
                   gl::GL_DYNAMIC_DRAW);
    gl::GenBuffers(1, &refNodeBuffer_);
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, refNodeBuffer_);
    const gl::GLsizeiptr nodeBytes = static_cast<gl::GLsizeiptr>(
        static_cast<std::uint64_t>(refWidth_) * static_cast<std::uint64_t>(refHeight_) *
        kReferenceCapacity * kReferenceNodeBytes);
    gl::BufferData(gl::GL_SHADER_STORAGE_BUFFER, nodeBytes, nullptr, gl::GL_DYNAMIC_DRAW);
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, 0);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);
    orderWboitCache_[0].clear();
    orderWboitCache_[1].clear();
    orderReferenceCache_[0].clear();
    orderReferenceCache_[1].clear();
    updateVramAccounting();
    referenceDirty_ = true;
}

void Renderer::destroySizedResources() {
    const gl::GLuint textures[] = {
        mainAccum_, mainReveal_, mainColor_, lowAccum_, lowReveal_, lowColor_,
        refColor_, refHeads_, errorTexture_,
    };
    for (gl::GLuint texture : textures) {
        if (texture) gl::DeleteTextures(1, &texture);
    }
    const gl::GLuint framebuffers[] = {
        mainFbo_, mainResolveFbo_, lowFbo_, lowResolveFbo_, refFbo_, errorFbo_,
    };
    for (gl::GLuint fbo : framebuffers) {
        if (fbo) gl::DeleteFramebuffers(1, &fbo);
    }
    const gl::GLuint buffers[] = {refCounterBuffer_, refNodeBuffer_};
    for (gl::GLuint buffer : buffers) {
        if (buffer) gl::DeleteBuffers(1, &buffer);
    }
    mainAccum_ = mainReveal_ = mainColor_ = 0;
    lowAccum_ = lowReveal_ = lowColor_ = 0;
    refColor_ = refHeads_ = errorTexture_ = 0;
    mainFbo_ = mainResolveFbo_ = lowFbo_ = lowResolveFbo_ = 0;
    refFbo_ = errorFbo_ = 0;
    refCounterBuffer_ = refNodeBuffer_ = 0;
    width_ = height_ = refWidth_ = refHeight_ = 0;
    metrics_ = RenderMetrics{};
    orderWboitCache_[0].clear();
    orderWboitCache_[1].clear();
    orderReferenceCache_[0].clear();
    orderReferenceCache_[1].clear();
}

void Renderer::updateVramAccounting() {
    if (width_ <= 0 || height_ <= 0) return;
    const std::uint64_t mainPixels =
        static_cast<std::uint64_t>(width_) * static_cast<std::uint64_t>(height_);
    const std::uint64_t refPixels =
        static_cast<std::uint64_t>(refWidth_) * static_cast<std::uint64_t>(refHeight_);
    metrics_.mainVramBytes = mainPixels * (8 + 2 + 4);
    metrics_.lowVramBytes = refPixels * (8 + 2 + 8);
    metrics_.referenceVramBytes =
        refPixels * (4 + 8 + 2) + 8 + refPixels * kReferenceCapacity * kReferenceNodeBytes;
    metrics_.refWidth = refWidth_;
    metrics_.refHeight = refHeight_;
}

void Renderer::orbit(float dx, float dy) {
    if (dx == 0.0f && dy == 0.0f) return;
    yaw_ += dx * 0.008f;
    pitch_ = std::clamp(pitch_ + dy * 0.006f, radians(-62.0f), radians(62.0f));
    referenceDirty_ = true;
}

void Renderer::zoom(float delta) {
    if (delta == 0.0f) return;
    distance_ = std::clamp(distance_ * std::pow(0.90f, delta), 5.2f, 22.0f);
    referenceDirty_ = true;
}

Vec3 Renderer::cameraPosition() const {
    const float cosPitch = std::cos(pitch_);
    return {
        distance_ * cosPitch * std::sin(yaw_),
        distance_ * std::sin(pitch_),
        distance_ * cosPitch * std::cos(yaw_),
    };
}

Mat4 Renderer::viewProjection(int width, int height) const {
    const float aspect = static_cast<float>(std::max(1, width)) /
                         static_cast<float>(std::max(1, height));
    const Mat4 projection = perspective(radians(39.0f), aspect, 0.1f, 40.0f);
    const Mat4 view = lookAt(cameraPosition(), {0.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f});
    return projection * view;
}

float Renderer::referenceScale() const {
    if (width_ <= 0) return 0.0f;
    return static_cast<float>(refWidth_) / static_cast<float>(width_);
}

std::string Renderer::cameraLabel() const {
    char buffer[128];
    std::snprintf(buffer, sizeof(buffer), "YAW %+.0f PITCH %+.0f DIST %.1f",
                  static_cast<double>(yaw_ * 180.0f / kPi),
                  static_cast<double>(pitch_ * 180.0f / kPi),
                  static_cast<double>(distance_));
    return buffer;
}

void Renderer::render(int targetFramebuffer, int width, int height, ViewMode mode) {
    ensureResources(width, height);
    renderAccumulation(width_, height_, false);
    resolveAccumulation(width_, height_, mainResolveFbo_);
    if (referenceDirty_ || !metrics_.valid) {
        renderPixelReference();
    }

    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, static_cast<gl::GLuint>(targetFramebuffer));
    gl::Viewport(0, 0, width_, height_);
    gl::Disable(gl::GL_DEPTH_TEST);
    gl::Disable(gl::GL_CULL_FACE);
    gl::Disable(gl::GL_BLEND);
    gl::ClearColor(0.01f, 0.015f, 0.025f, 1.0f);
    gl::Clear(gl::GL_COLOR_BUFFER_BIT);
    gl::UseProgram(displayProgram_);
    gl::Uniform1i(gl::GetUniformLocation(displayProgram_, "uWboit"), 0);
    gl::Uniform1i(gl::GetUniformLocation(displayProgram_, "uReference"), 1);
    gl::Uniform1i(gl::GetUniformLocation(displayProgram_, "uError"), 2);
    gl::Uniform2f(gl::GetUniformLocation(displayProgram_, "uResolution"),
                  static_cast<float>(width_), static_cast<float>(height_));
    gl::Uniform1i(gl::GetUniformLocation(displayProgram_, "uMode"),
                  static_cast<int>(mode));
    const float errorGain =
        1.0f / std::max(0.02f, static_cast<float>(metrics_.maxError) * 1.2f);
    gl::Uniform1f(gl::GetUniformLocation(displayProgram_, "uErrorGain"), errorGain);
    gl::ActiveTexture(gl::GL_TEXTURE0);
    gl::BindTexture(gl::GL_TEXTURE_2D, mainColor_);
    gl::ActiveTexture(gl::GL_TEXTURE1);
    gl::BindTexture(gl::GL_TEXTURE_2D, refColor_);
    gl::ActiveTexture(gl::GL_TEXTURE2);
    gl::BindTexture(gl::GL_TEXTURE_2D, errorTexture_);
    drawFullscreen();
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);
}

void Renderer::renderAccumulation(int width, int height, bool lowResolution) {
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, lowResolution ? lowFbo_ : mainFbo_);
    gl::Viewport(0, 0, width, height);
    const gl::GLfloat zero[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    const gl::GLfloat one[4] = {1.0f, 0.0f, 0.0f, 0.0f};
    gl::ClearBufferfv(gl::GL_COLOR, 0, zero);
    gl::ClearBufferfv(gl::GL_COLOR, 1, one);
    gl::Disable(gl::GL_DEPTH_TEST);
    gl::Disable(gl::GL_CULL_FACE);
    gl::Enable(gl::GL_BLEND);
    gl::Enablei(gl::GL_BLEND, 0);
    gl::Enablei(gl::GL_BLEND, 1);
    gl::BlendEquation(gl::GL_FUNC_ADD);
    gl::BlendFuncSeparatei(0, gl::GL_ONE, gl::GL_ONE, gl::GL_ONE, gl::GL_ONE);
    gl::BlendFuncSeparatei(1, gl::GL_ZERO, gl::GL_ONE_MINUS_SRC_ALPHA,
                           gl::GL_ZERO, gl::GL_ONE_MINUS_SRC_ALPHA);
    drawSceneGeometry(wboitProgram_, width, height);
    gl::Disable(gl::GL_BLEND);
}

void Renderer::resolveAccumulation(int width, int height, gl::GLuint outputFbo) {
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, outputFbo);
    gl::Viewport(0, 0, width, height);
    gl::Disable(gl::GL_DEPTH_TEST);
    gl::Disable(gl::GL_CULL_FACE);
    gl::Disable(gl::GL_BLEND);
    gl::UseProgram(resolveProgram_);
    const gl::GLint accumLocation = gl::GetUniformLocation(resolveProgram_, "uAccumulation");
    const gl::GLint revealLocation = gl::GetUniformLocation(resolveProgram_, "uRevealage");
    gl::Uniform1i(accumLocation, 0);
    gl::Uniform1i(revealLocation, 1);
    gl::Uniform2f(gl::GetUniformLocation(resolveProgram_, "uResolution"),
                  static_cast<float>(width), static_cast<float>(height));
    gl::ActiveTexture(gl::GL_TEXTURE0);
    gl::BindTexture(gl::GL_TEXTURE_2D, outputFbo == mainResolveFbo_ ? mainAccum_ : lowAccum_);
    gl::ActiveTexture(gl::GL_TEXTURE1);
    gl::BindTexture(gl::GL_TEXTURE_2D, outputFbo == mainResolveFbo_ ? mainReveal_ : lowReveal_);
    drawFullscreen();
}

void Renderer::drawSceneGeometry(gl::GLuint program, int width, int height) {
    gl::UseProgram(program);
    const Mat4 vp = viewProjection(width, height);
    const Vec3 eye = cameraPosition();
    gl::UniformMatrix4fv(gl::GetUniformLocation(program, "uViewProjection"), 1, gl::GL_FALSE,
                         vp.m);
    gl::Uniform3f(gl::GetUniformLocation(program, "uCameraPosition"), eye.x, eye.y, eye.z);
    const int bundleCount = static_cast<int>(meshes_.size());
    for (int step = 0; step < bundleCount; ++step) {
        const int bundle = drawOrder_ == DrawOrder::Forward ? step : bundleCount - 1 - step;
        const Mesh &mesh = meshes_[static_cast<std::size_t>(bundle)];
        gl::Uniform3f(gl::GetUniformLocation(program, "uColor"),
                      mesh.color.x, mesh.color.y, mesh.color.z);
        gl::Uniform1f(gl::GetUniformLocation(program, "uAlpha"), sceneInfo_.alpha);
        gl::BindVertexArray(mesh.vao);
        gl::DrawArrays(gl::GL_TRIANGLES, 0, mesh.vertexCount);
    }
    gl::BindVertexArray(0);
}

void Renderer::drawFullscreen() {
    gl::BindVertexArray(fullscreenVao_);
    gl::DrawArrays(gl::GL_TRIANGLES, 0, 3);
    gl::BindVertexArray(0);
}

void Renderer::renderPixelReference() {
    const auto start = std::chrono::steady_clock::now();
    renderAccumulation(refWidth_, refHeight_, true);
    resolveAccumulation(refWidth_, refHeight_, lowResolveFbo_);

    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, refFbo_);
    gl::Viewport(0, 0, refWidth_, refHeight_);
    gl::Disable(gl::GL_DEPTH_TEST);
    gl::Disable(gl::GL_CULL_FACE);
    gl::Disable(gl::GL_BLEND);

    const gl::GLuint zeroCounter[2] = {0u, 0u};
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, refCounterBuffer_);
    gl::BufferSubData(gl::GL_SHADER_STORAGE_BUFFER, 0, sizeof(zeroCounter), zeroCounter);
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, 0);
    gl::ClearTexImage(refHeads_, 0, gl::GL_RED_INTEGER, gl::GL_UNSIGNED_INT, nullptr);

    gl::UseProgram(referenceProgram_);
    const gl::GLuint nodeCapacity = static_cast<gl::GLuint>(
        static_cast<std::uint64_t>(refWidth_) * static_cast<std::uint64_t>(refHeight_) *
        kReferenceCapacity);
    gl::Uniform1ui(gl::GetUniformLocation(referenceProgram_, "uNodeCapacity"), nodeCapacity);
    gl::BindImageTexture(0, refHeads_, 0, gl::GL_FALSE, 0, gl::GL_READ_WRITE, gl::GL_R32UI);
    gl::BindBufferBase(gl::GL_SHADER_STORAGE_BUFFER, 1, refCounterBuffer_);
    gl::BindBufferBase(gl::GL_SHADER_STORAGE_BUFFER, 2, refNodeBuffer_);
    drawSceneGeometry(referenceProgram_, refWidth_, refHeight_);

    gl::MemoryBarrier(gl::GL_SHADER_STORAGE_BARRIER_BIT |
                      gl::GL_SHADER_IMAGE_ACCESS_BARRIER_BIT);
    gl::UseProgram(referenceResolveProgram_);
    gl::Uniform2f(gl::GetUniformLocation(referenceResolveProgram_, "uResolution"),
                  static_cast<float>(refWidth_), static_cast<float>(refHeight_));
    gl::Uniform1ui(gl::GetUniformLocation(referenceResolveProgram_, "uNodeCapacity"),
                   nodeCapacity);
    gl::BindImageTexture(0, refHeads_, 0, gl::GL_FALSE, 0, gl::GL_READ_ONLY, gl::GL_R32UI);
    gl::BindImageTexture(1, refColor_, 0, gl::GL_FALSE, 0, gl::GL_WRITE_ONLY,
                         gl::GL_RGBA16F);
    gl::BindBufferBase(gl::GL_SHADER_STORAGE_BUFFER, 1, refCounterBuffer_);
    gl::BindBufferBase(gl::GL_SHADER_STORAGE_BUFFER, 2, refNodeBuffer_);
    gl::DispatchCompute(static_cast<gl::GLuint>((refWidth_ + 7) / 8),
                        static_cast<gl::GLuint>((refHeight_ + 7) / 8), 1);
    gl::MemoryBarrier(gl::GL_SHADER_IMAGE_ACCESS_BARRIER_BIT);

    gl::UseProgram(errorProgram_);
    gl::BindImageTexture(0, lowColor_, 0, gl::GL_FALSE, 0, gl::GL_READ_ONLY, gl::GL_RGBA16F);
    gl::BindImageTexture(1, refColor_, 0, gl::GL_FALSE, 0, gl::GL_READ_ONLY, gl::GL_RGBA16F);
    gl::BindImageTexture(2, errorTexture_, 0, gl::GL_FALSE, 0, gl::GL_WRITE_ONLY, gl::GL_R16F);
    gl::DispatchCompute(static_cast<gl::GLuint>((refWidth_ + 7) / 8),
                        static_cast<gl::GLuint>((refHeight_ + 7) / 8), 1);
    gl::MemoryBarrier(gl::GL_SHADER_IMAGE_ACCESS_BARRIER_BIT);
    gl::Finish();

    measureMetrics();
    const auto end = std::chrono::steady_clock::now();
    metrics_.referenceMs =
        std::chrono::duration<double, std::milli>(end - start).count();
    referenceDirty_ = false;
}

void Renderer::measureMetrics() {
    const std::size_t pixelCount =
        static_cast<std::size_t>(refWidth_) * static_cast<std::size_t>(refHeight_);
    std::vector<float> wboit(pixelCount * 4);
    std::vector<float> reference(pixelCount * 4);
    gl::PixelStorei(gl::GL_PACK_ALIGNMENT, 1);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, lowResolveFbo_);
    gl::ReadBuffer(gl::GL_COLOR_ATTACHMENT0);
    gl::ReadPixels(0, 0, refWidth_, refHeight_, gl::GL_RGBA, gl::GL_FLOAT, wboit.data());
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, refFbo_);
    gl::ReadBuffer(gl::GL_COLOR_ATTACHMENT0);
    gl::ReadPixels(0, 0, refWidth_, refHeight_, gl::GL_RGBA, gl::GL_FLOAT, reference.data());
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);

    std::vector<float> errors(pixelCount);
    double sum = 0.0;
    double squaredSum = 0.0;
    double maximum = 0.0;
    std::size_t changed = 0;
    for (std::size_t i = 0; i < pixelCount; ++i) {
        const float dr = std::clamp(reference[i * 4 + 0] - wboit[i * 4 + 0], -1.0f, 1.0f);
        const float dg = std::clamp(reference[i * 4 + 1] - wboit[i * 4 + 1], -1.0f, 1.0f);
        const float db = std::clamp(reference[i * 4 + 2] - wboit[i * 4 + 2], -1.0f, 1.0f);
        const float error = std::abs(dr) * 0.2126f + std::abs(dg) * 0.7152f +
                            std::abs(db) * 0.0722f;
        errors[i] = error;
        sum += error;
        squaredSum += static_cast<double>(error) * error;
        maximum = std::max(maximum, static_cast<double>(error));
        if (error > (1.0f / 255.0f)) ++changed;
    }
    std::sort(errors.begin(), errors.end());
    metrics_.mae = pixelCount ? sum / static_cast<double>(pixelCount) : 0.0;
    metrics_.rmse = pixelCount ? std::sqrt(squaredSum / static_cast<double>(pixelCount)) : 0.0;
    metrics_.maxError = maximum;
    metrics_.p95Error = errors.empty()
                            ? 0.0
                            : errors[std::min(errors.size() - 1,
                                              (errors.size() * 95) / 100)];
    metrics_.changedPercent =
        pixelCount ? 100.0 * static_cast<double>(changed) / static_cast<double>(pixelCount)
                   : 0.0;

    const auto luminanceDelta = [](const std::vector<float> &a, const std::vector<float> &b) {
        if (a.empty() || a.size() != b.size()) return -1.0;
        double total = 0.0;
        for (std::size_t i = 0; i < a.size(); i += 4) {
            total += std::abs(a[i + 0] - b[i + 0]) * 0.2126 +
                     std::abs(a[i + 1] - b[i + 1]) * 0.7152 +
                     std::abs(a[i + 2] - b[i + 2]) * 0.0722;
        }
        return total / static_cast<double>(a.size() / 4);
    };
    const int orderIndex = static_cast<int>(drawOrder_);
    metrics_.orderDeltaWboit =
        luminanceDelta(wboit, orderWboitCache_[1 - orderIndex]);
    metrics_.orderDeltaReference =
        luminanceDelta(reference, orderReferenceCache_[1 - orderIndex]);
    orderWboitCache_[orderIndex] = wboit;
    orderReferenceCache_[orderIndex] = reference;

    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, refCounterBuffer_);
    gl::GLuint counter[2] = {0u, 0u};
    gl::GetBufferSubData(gl::GL_SHADER_STORAGE_BUFFER, 0, sizeof(counter), counter);
    gl::BindBuffer(gl::GL_SHADER_STORAGE_BUFFER, 0);
    metrics_.totalFragments = counter[0];
    metrics_.overflowFragments = counter[1];
    metrics_.refWidth = refWidth_;
    metrics_.refHeight = refHeight_;
    metrics_.valid = true;
    updateVramAccounting();
}

}  // namespace oit
