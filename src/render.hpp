#pragma once

#include "math.hpp"
#include "mesh.hpp"

#include <cstdint>
#include <string>
#include <vector>

struct Camera {
    Vec3 position{-0.2f, 2.4f, 8.6f};
    Vec3 target{0.0f, 1.15f, 0.0f};
    Vec3 up{0.0f, 1.0f, 0.0f};
    float fovYDegrees = 46.0f;
    float aspect = 16.0f / 9.0f;
    float nearPlane = 0.08f;
    float farPlane = 120.0f;

    Mat4 view() const;
    Mat4 projection() const;
    Mat4 viewProjection() const;
    Ray rayThroughPixel(int x, int y, int width, int height) const;
};

struct PointLight {
    Vec3 position{4.6f, 5.0f, 3.0f};
    Vec3 color{1.0f, 0.86f, 0.66f};
    float intensity = 1.0f;
    float orbitRadius = 4.8f;
    float orbitHeight = 5.0f;
    float phase = 0.0f;

    static PointLight fromPhase(float phase);
};

struct Scene {
    std::vector<Mesh> casters;
    Mesh floor;
    float floorHalfExtent = 30.0f;
};

Scene buildDemoScene();

struct RenderOptions {
    bool captureStencil = true;
    bool captureDebug = false;
    bool drawEdges = false;
    bool drawVolumeWireframe = false;
    float extrusionDistance = 42.0f;
};

struct ImageRgb {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> pixels;

    bool empty() const { return pixels.empty(); }
};

struct RenderResult {
    ImageRgb finalImage;
    ImageRgb debugImage;
    ImageRgb edgesImage;
    std::vector<uint8_t> stencil;
    int width = 0;
    int height = 0;
    int silhouetteEdgeCount = 0;
    int frontCapIndices = 0;
    int backCapIndices = 0;
    int sideIndices = 0;
    int nonManifoldEdges = 0;
    int volumeTriangles = 0;
};

class Renderer {
public:
    Renderer() = default;
    ~Renderer();

    bool initialize(const Scene& scene, int width, int height, std::string& error);
    RenderResult render(const Camera& camera, const PointLight& light,
                        const RenderOptions& options);

    const std::string& glVersion() const { return glVersion_; }
    const std::string& glRenderer() const { return glRenderer_; }
    const std::string& glslVersion() const { return glslVersion_; }

private:
    struct GpuMesh {
        uint32_t vao = 0;
        uint32_t vbo = 0;
        uint32_t ebo = 0;
        int indexCount = 0;
    };

    bool initializeEgl(std::string& error);
    bool initializeFramebuffer(std::string& error);
    bool initializePrograms(std::string& error);
    void uploadScene(const Scene& scene);
    void uploadShadowVolume(const ShadowVolume& volume);
    void drawMesh(const GpuMesh& mesh);
    void drawCastersShaded(const Camera& camera, const PointLight& light, bool depthEqual);
    void drawFullscreen(uint32_t program, uint32_t targetFramebuffer, int width, int height);
    void drawShadowVolumes(const Scene& scene, Vec3 lightPosition, const Mat4& viewProjection,
                           const RenderOptions& options, RenderResult& result);
    void drawDebugOverlay();
    void drawEdgeOverlay(const Scene& scene, Vec3 lightPosition, bool volumeWireframe);
    void readColor(ImageRgb& image);
    void readStencil(std::vector<uint8_t>& stencil);
    void destroyGlResources();

    int width_ = 0;
    int height_ = 0;
    bool initialized_ = false;
    void* eglDisplay_ = nullptr;
    void* eglSurface_ = nullptr;
    void* eglContext_ = nullptr;

    uint32_t fbo_ = 0;
    uint32_t colorTexture_ = 0;
    uint32_t depthStencilBuffer_ = 0;
    uint32_t emptyVao_ = 0;

    uint32_t sceneProgram_ = 0;
    uint32_t shadowProgram_ = 0;
    uint32_t skyProgram_ = 0;
    uint32_t overlayProgram_ = 0;
    uint32_t lineProgram_ = 0;

    uint32_t shadowVao_ = 0;
    uint32_t shadowVbo_ = 0;
    uint32_t shadowEbo_ = 0;
    size_t shadowVboCapacity_ = 0;
    size_t shadowEboCapacity_ = 0;

    uint32_t lineVao_ = 0;
    uint32_t lineVbo_ = 0;
    size_t lineVboCapacity_ = 0;

    GpuMesh floorGpu_;
    std::vector<GpuMesh> casterGpu_;
    Scene scene_;
    Mat4 currentViewProjection_ = Mat4::identity();
    std::string glVersion_;
    std::string glRenderer_;
    std::string glslVersion_;
};

