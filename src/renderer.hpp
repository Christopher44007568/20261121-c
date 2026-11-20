#pragma once

#include "gl_api.hpp"
#include "math.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace oit {

enum class ScenePreset : int {
    NearOpaque = 0,
    Multilayer = 1,
    Count,
};

enum class ViewMode : int {
    Wboit = 0,
    Reference = 1,
    Error = 2,
    Compare = 3,
    Count,
};

enum class DrawOrder : int {
    Forward = 0,
    Reverse = 1,
};

struct RenderMetrics {
    bool valid = false;
    int refWidth = 0;
    int refHeight = 0;
    double mae = 0.0;
    double rmse = 0.0;
    double maxError = 0.0;
    double p95Error = 0.0;
    double changedPercent = 0.0;
    double orderDeltaWboit = -1.0;
    double orderDeltaReference = -1.0;
    double referenceMs = 0.0;
    std::uint64_t totalFragments = 0;
    std::uint64_t overflowFragments = 0;
    std::uint64_t mainVramBytes = 0;
    std::uint64_t lowVramBytes = 0;
    std::uint64_t referenceVramBytes = 0;
    std::uint64_t totalVramBytes() const {
        return mainVramBytes + lowVramBytes + referenceVramBytes;
    }
};

struct SceneInfo {
    int bundles = 0;
    int tubesPerBundle = 0;
    int totalTubes = 0;
    float alpha = 0.0f;
};

class Renderer {
public:
    Renderer() = default;
    ~Renderer();

    bool init(std::string *error);
    void setScene(ScenePreset scene);
    void setDrawOrder(DrawOrder order);
    void toggleDrawOrder();
    void orbit(float dx, float dy);
    void zoom(float delta);
    void markReferenceDirty() { referenceDirty_ = true; }

    void render(int targetFramebuffer, int width, int height, ViewMode mode);

    ScenePreset scene() const { return scene_; }
    DrawOrder drawOrder() const { return drawOrder_; }
    const SceneInfo &sceneInfo() const { return sceneInfo_; }
    const RenderMetrics &metrics() const { return metrics_; }
    bool referenceDirty() const { return referenceDirty_; }
    float referenceScale() const;
    std::string cameraLabel() const;

private:
    struct Mesh {
        gl::GLuint vao = 0;
        gl::GLuint vbo = 0;
        int vertexCount = 0;
        Vec3 color{};
    };

    void release();
    void rebuildScene();
    void buildBundleMesh(int bundleIndex, Vec3 axis, Vec3 center, std::vector<Mesh> *meshes);
    void ensureResources(int width, int height);
    void destroySizedResources();
    void recreateSizedResources();
    void renderAccumulation(int width, int height, bool lowResolution);
    void resolveAccumulation(int width, int height, gl::GLuint outputFbo);
    void renderPixelReference();
    void computeError();
    void measureMetrics();
    void drawSceneGeometry(gl::GLuint program, int width, int height);
    void drawFullscreen();
    void updateVramAccounting();
    Mat4 viewProjection(int width, int height) const;
    Vec3 cameraPosition() const;
    static Vec3 bundleAxis(int index, ScenePreset scene);

    gl::GLuint loadProgram(const char *vertexPath, const char *fragmentPath, std::string *error);
    gl::GLuint loadComputeProgram(const char *path, std::string *error);
    gl::GLuint compileShaderFromFile(gl::GLenum type, const char *path, std::string *error);

    ScenePreset scene_ = ScenePreset::NearOpaque;
    DrawOrder drawOrder_ = DrawOrder::Forward;
    SceneInfo sceneInfo_{};
    std::vector<Mesh> meshes_;
    RenderMetrics metrics_{};
    bool referenceDirty_ = true;
    int width_ = 0;
    int height_ = 0;
    int refWidth_ = 0;
    int refHeight_ = 0;
    float yaw_ = radians(37.0f);
    float pitch_ = radians(20.0f);
    float distance_ = 10.5f;

    gl::GLuint wboitProgram_ = 0;
    gl::GLuint resolveProgram_ = 0;
    gl::GLuint displayProgram_ = 0;
    gl::GLuint referenceProgram_ = 0;
    gl::GLuint referenceResolveProgram_ = 0;
    gl::GLuint errorProgram_ = 0;
    gl::GLuint fullscreenVao_ = 0;

    gl::GLuint mainFbo_ = 0;
    gl::GLuint mainAccum_ = 0;
    gl::GLuint mainReveal_ = 0;
    gl::GLuint mainResolveFbo_ = 0;
    gl::GLuint mainColor_ = 0;
    gl::GLuint lowFbo_ = 0;
    gl::GLuint lowAccum_ = 0;
    gl::GLuint lowReveal_ = 0;
    gl::GLuint lowResolveFbo_ = 0;
    gl::GLuint lowColor_ = 0;
    gl::GLuint refFbo_ = 0;
    gl::GLuint refColor_ = 0;
    gl::GLuint refHeads_ = 0;
    gl::GLuint refCounterBuffer_ = 0;
    gl::GLuint refNodeBuffer_ = 0;
    gl::GLuint errorFbo_ = 0;
    gl::GLuint errorTexture_ = 0;

    std::vector<float> orderWboitCache_[2];
    std::vector<float> orderReferenceCache_[2];
};

const char *sceneName(ScenePreset scene);
const char *viewName(ViewMode view);
const char *orderName(DrawOrder order);

}  // namespace oit
