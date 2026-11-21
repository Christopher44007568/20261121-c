#pragma once

#include "render.hpp"

#include <string>
#include <vector>

struct PixelSample {
    int x = 0;
    int y = 0;
    bool cpuShadow = false;
    bool gpuShadow = false;
    int object = -1;
};

struct FrameCheck {
    float t = 0.0f;
    bool cameraInsideShadow = false;
    bool cameraInsideCaster = false;
    bool nearPlaneCrossesScene = false;
    int samples = 0;
    int mismatches = 0;
    std::vector<PixelSample> mismatchPoints;
    std::vector<PixelSample> spotChecks;
};

struct PathCheck {
    std::string name;
    float lightPhase = 0.0f;
    int insideShadowFrames = 0;
    int outsideShadowFrames = 0;
    int enterExitTransitions = 0;
    int nearPlaneCrossingFrames = 0;
    bool cameraInsideCasterAny = false;
    std::vector<FrameCheck> frames;
};

struct SampleCheck {
    int samples = 0;
    int mismatches = 0;
    std::vector<PixelSample> points;
    std::vector<PixelSample> mismatchPoints;
};

bool nearPlaneCrossesScene(const Scene& scene, const Camera& camera);
bool cameraInsideAnyCaster(const Scene& scene, const Camera& camera);
bool cameraInsideShadow(const Scene& scene, const Camera& camera, Vec3 lightPosition);

FrameCheck validateFrame(const Scene& scene, const Camera& camera, Vec3 lightPosition,
                         const std::vector<uint8_t>& stencil, int width, int height,
                         float t, bool collectStableSamples = true, int stride = 23);

std::string validationJson(const std::string& glVersion, const std::string& glRenderer,
                           const std::string& glslVersion, const SampleCheck& hero,
                           const PathCheck& shadowPath, const PathCheck& nearPath,
                           const RenderResult& stats);

void writeFramesCsv(const std::string& path, const PathCheck& shadowPath,
                    const PathCheck& nearPath);

