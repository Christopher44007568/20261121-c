#pragma once

#include "core/Geometry.h"
#include "core/SceneIndex.h"

#include <cstdint>
#include <unordered_set>
#include <vector>

namespace pcloud {

struct PlannerConfig {
    double sseThresholdPixels = 6.0;
    std::size_t maxFrontierNodes = 32'768;
    std::size_t maxLookaheadCameras = 6;
};

struct RenderItem {
    std::uint32_t nodeId = kInvalidNode;
    double screenSpaceError = 0.0;
    double distance = 0.0;
    std::uint8_t depth = 0;
    bool fallback = false;
};

struct RequestItem {
    std::uint32_t nodeId = kInvalidNode;
    double priority = 0.0;
    double screenSpaceError = 0.0;
    bool fallback = false;
    bool fromLookahead = false;
};

struct FramePlan {
    std::vector<RenderItem> render;
    std::vector<RequestItem> requests;
    std::uint64_t missingChunks = 0;
    std::uint64_t duplicateNodes = 0;
    std::uint64_t requiredFrontier = 0;
    bool traversalLimited = false;
};

class FramePlanner {
public:
    explicit FramePlanner(PlannerConfig config = {}) : config_(config) {}

    FramePlan plan(const SceneIndex& scene,
                   const CameraView& camera,
                   const std::unordered_set<std::uint32_t>& gpuReady,
                   const std::unordered_set<std::uint32_t>& available,
                   const std::vector<CameraView>& lookaheadCameras = {}) const;

    static std::uint64_t countDuplicateRenderedNodes(
        const SceneIndex& scene,
        const std::vector<RenderItem>& rendered);

    void setConfig(const PlannerConfig& config) { config_ = config; }
    const PlannerConfig& config() const { return config_; }

private:
    PlannerConfig config_;
};

}  // namespace pcloud
