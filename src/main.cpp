#include "mesh.hpp"
#include "png.hpp"
#include "render.hpp"
#include "validation.hpp"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr int kWidth = 960;
constexpr int kHeight = 540;
constexpr float kHeroPhase = 0.55f;
constexpr float kShadowPathPhase = 3.95f;
constexpr float kNearPathPhase = 2.55f;

void ensureDirectories() {
    std::filesystem::create_directories("artifacts/images");
    std::filesystem::create_directories("artifacts/verify");
    std::filesystem::create_directories("artifacts/frames/shadow_path");
    std::filesystem::create_directories("artifacts/frames/near_path");
    std::filesystem::create_directories("artifacts/frames/orbit");
}

bool savePng(const std::filesystem::path& path, const ImageRgb& image) {
    if (!writePng(path.string(), image)) {
        std::cerr << "failed to write " << path << '\n';
        return false;
    }
    return true;
}

Camera heroCamera() {
    Camera camera;
    camera.position = {0.0f, 2.75f, 9.15f};
    camera.target = {0.0f, 1.12f, 0.0f};
    camera.fovYDegrees = 46.0f;
    camera.aspect = static_cast<float>(kWidth) / kHeight;
    camera.nearPlane = 0.08f;
    camera.farPlane = 120.0f;
    return camera;
}

Camera shadowPathCamera(float t) {
    Camera camera = heroCamera();
    camera.position = lerp({-2.0f, 1.62f, 2.8f}, {9.5f, 1.62f, 2.8f}, t);
    camera.target = {0.0f, 1.15f, 0.0f};
    camera.fovYDegrees = 50.0f;
    return camera;
}

Camera nearPathCamera(float t) {
    Camera camera = heroCamera();
    const float eased = 1.0f - std::pow(1.0f - t, 3.0f);
    camera.position = lerp({0.20f, 2.20f, 5.2f}, {-0.90f, 2.20f, 0.22f}, eased);
    camera.target = {0.70f, 0.75f, -0.70f};
    camera.fovYDegrees = 54.0f;
    camera.nearPlane = 0.08f;
    return camera;
}

struct PathFrame {
    Camera camera;
    RenderResult result;
    FrameCheck check;
};

PathCheck runPath(const std::string& name, float lightPhase,
                  const std::function<Camera(float)>& cameraAt,
                  Renderer& renderer, const Scene& scene,
                  const std::filesystem::path& frameDirectory,
                  std::vector<PathFrame>& frames,
                  int& firstTransition, int& secondTransition,
                  int& firstNearCrossing) {
    PathCheck path;
    path.name = name;
    path.lightPhase = lightPhase;
    const PointLight light = PointLight::fromPhase(lightPhase);
    firstTransition = -1;
    secondTransition = -1;
    firstNearCrossing = -1;
    for (int i = 0; i <= 10; ++i) {
        const float t = static_cast<float>(i) / 10.0f;
        PathFrame frame;
        frame.camera = cameraAt(t);
        RenderOptions options;
        options.captureStencil = true;
        options.captureDebug = true;
        options.extrusionDistance = 42.0f;
        frame.result = renderer.render(frame.camera, light, options);
        frame.check = validateFrame(scene, frame.camera, light.position,
                                    frame.result.stencil, kWidth, kHeight, t);
        std::ostringstream frameName;
        frameName << std::setw(2) << std::setfill('0') << i << ".png";
        savePng(frameDirectory / frameName.str(), frame.result.finalImage);
        if (frame.check.cameraInsideShadow) {
            ++path.insideShadowFrames;
        } else {
            ++path.outsideShadowFrames;
        }
        if (frame.check.nearPlaneCrossesScene) {
            ++path.nearPlaneCrossingFrames;
            if (firstNearCrossing < 0) {
                firstNearCrossing = i;
            }
        }
        path.cameraInsideCasterAny = path.cameraInsideCasterAny ||
                                     frame.check.cameraInsideCaster;
        if (!path.frames.empty() &&
            path.frames.back().cameraInsideShadow != frame.check.cameraInsideShadow) {
            ++path.enterExitTransitions;
            if (firstTransition < 0) {
                firstTransition = i;
            } else if (secondTransition < 0) {
                secondTransition = i;
            }
        }
        path.frames.push_back(frame.check);
        frames.push_back(std::move(frame));
    }
    return path;
}

void saveSpotCheckImage(const std::string& path, const ImageRgb& split,
                        const std::vector<PixelSample>& points, int leftWidth,
                        int panelGap) {
    ImageRgb image = split;
    for (const PixelSample& point : points) {
        const bool match = point.cpuShadow == point.gpuShadow;
        const uint8_t r = match ? 32 : 255;
        const uint8_t g = match ? 238 : 42;
        const uint8_t b = match ? 84 : 42;
        drawCross(image, point.x, point.y, 6, r, g, b);
        drawCross(image, leftWidth + panelGap + point.x, point.y, 6, r, g, b);
    }
    savePng(path, image);
}

}  // namespace

int main() {
    ensureDirectories();
    const Scene scene = buildDemoScene();
    Renderer renderer;
    std::string error;
    if (!renderer.initialize(scene, kWidth, kHeight, error)) {
        std::cerr << "renderer initialization failed:\n" << error << '\n';
        return 1;
    }
    std::cout << "OpenGL: " << renderer.glVersion() << " | "
              << renderer.glRenderer() << " | GLSL " << renderer.glslVersion() << '\n';

    const Camera hero = heroCamera();
    const PointLight heroLight = PointLight::fromPhase(kHeroPhase);
    RenderOptions heroOptions;
    heroOptions.captureStencil = true;
    heroOptions.captureDebug = true;
    const RenderResult heroResult = renderer.render(hero, heroLight, heroOptions);
    int nonzeroStencil = 0;
    for (uint8_t value : heroResult.stencil) {
        nonzeroStencil += value != 0 ? 1 : 0;
    }
    savePng("artifacts/images/hero_final.png", heroResult.finalImage);
    savePng("artifacts/images/hero_debug.png", heroResult.debugImage);
    const ImageRgb heroSplit = composeHorizontal(heroResult.finalImage,
                                                 heroResult.debugImage, 4);
    savePng("artifacts/images/hero_split.png", heroSplit);

    RenderOptions edgeOptions;
    edgeOptions.captureStencil = false;
    edgeOptions.drawEdges = true;
    edgeOptions.drawVolumeWireframe = true;
    const RenderResult edgeResult = renderer.render(hero, heroLight, edgeOptions);
    savePng("artifacts/images/hero_edges.png", edgeResult.edgesImage);

    const FrameCheck heroCheck = validateFrame(scene, hero, heroLight.position,
                                               heroResult.stencil, kWidth, kHeight,
                                               0.0f, true, 19);
    SampleCheck sampleCheck;
    sampleCheck.samples = heroCheck.samples;
    sampleCheck.mismatches = heroCheck.mismatches;
    sampleCheck.points = heroCheck.spotChecks;
    sampleCheck.mismatchPoints = heroCheck.mismatchPoints;
    saveSpotCheckImage("artifacts/images/hero_spotchecks.png", heroSplit,
                       sampleCheck.points, kWidth, 4);

    std::vector<PathFrame> shadowFrames;
    std::vector<PathFrame> nearFrames;
    int shadowEnter = -1;
    int shadowExit = -1;
    int unusedNear = -1;
    const PathCheck shadowPath = runPath(
        "camera_shadow_crossing", kShadowPathPhase, shadowPathCamera, renderer, scene,
        "artifacts/frames/shadow_path", shadowFrames, shadowEnter, shadowExit,
        unusedNear);

    int nearUnusedEnter = -1;
    int nearUnusedExit = -1;
    int nearCrossing = -1;
    const PathCheck nearPath = runPath(
        "near_clip_crossing", kNearPathPhase, nearPathCamera, renderer, scene,
        "artifacts/frames/near_path", nearFrames, nearUnusedEnter, nearUnusedExit,
        nearCrossing);

    if (shadowEnter >= 0) {
        const ImageRgb split = composeHorizontal(shadowFrames[shadowEnter].result.finalImage,
                                                 shadowFrames[shadowEnter].result.debugImage, 4);
        savePng("artifacts/images/shadow_path_enter_split.png", split);
        savePng("artifacts/images/shadow_path_split.png", split);
    }
    if (shadowExit >= 0) {
        const ImageRgb split = composeHorizontal(shadowFrames[shadowExit].result.finalImage,
                                                 shadowFrames[shadowExit].result.debugImage, 4);
        savePng("artifacts/images/shadow_path_exit_split.png", split);
    }
    if (nearCrossing >= 0) {
        const ImageRgb split = composeHorizontal(nearFrames[nearCrossing].result.finalImage,
                                                 nearFrames[nearCrossing].result.debugImage, 4);
        savePng("artifacts/images/near_clip_crossing_split.png", split);
    }

    const PointLight orbitLight = PointLight::fromPhase(0.0f);
    for (int i = 0; i < 12; ++i) {
        Camera camera = hero;
        const float phase = 2.0f * kPi * static_cast<float>(i) / 12.0f;
        const PointLight light = PointLight::fromPhase(phase);
        (void)orbitLight;
        RenderOptions options;
        options.captureStencil = false;
        const RenderResult frame = renderer.render(camera, light, options);
        std::ostringstream name;
        name << "artifacts/frames/orbit/" << std::setw(2) << std::setfill('0')
             << i << ".png";
        savePng(name.str(), frame.finalImage);
    }

    const std::string report = validationJson(
        renderer.glVersion(), renderer.glRenderer(), renderer.glslVersion(),
        sampleCheck, shadowPath, nearPath, heroResult);
    std::ofstream("artifacts/verify/verification.json") << report;
    writeFramesCsv("artifacts/verify/frames.csv", shadowPath, nearPath);

    std::cout << "silhouette edges: " << heroResult.silhouetteEdgeCount
              << " | volume triangles: " << heroResult.volumeTriangles << '\n';
    std::cout << "hero stencil pixels != 0: " << nonzeroStencil << '\n';
    std::cout << "hero CPU/GPU samples: " << sampleCheck.samples
              << " | mismatches: " << sampleCheck.mismatches << '\n';
    std::cout << "shadow path transitions: " << shadowPath.enterExitTransitions
              << " | inside frames: " << shadowPath.insideShadowFrames << '\n';
    std::cout << "near clip crossing frames: " << nearPath.nearPlaneCrossingFrames << '\n';
    return 0;
}
