#include "core/FramePlanner.h"

#include <algorithm>
#include <functional>
#include <unordered_map>

namespace pcloud {
namespace {

struct DesiredNode {
    std::uint32_t id = kInvalidNode;
    double sse = 0.0;
    double distance = 0.0;
};

}  // namespace

FramePlan FramePlanner::plan(const SceneIndex& scene,
                             const CameraView& camera,
                             const std::unordered_set<std::uint32_t>& gpuReady,
                             const std::unordered_set<std::uint32_t>& available,
                             const std::vector<CameraView>& lookaheadCameras) const {
    FramePlan plan;
    if (scene.nodeCount() == 0) {
        return plan;
    }

    std::unordered_map<std::uint32_t, RequestItem> requestMap;
    std::vector<DesiredNode> desired;
    desired.reserve(512);
    std::size_t traversed = 0;

    std::function<void(std::uint32_t, const CameraView&, double, bool)> visit;
    visit = [&](std::uint32_t id, const CameraView& view, double weight, bool current) {
        if (traversed >= config_.maxFrontierNodes) {
            plan.traversalLimited = true;
            return;
        }
        ++traversed;
        const DiskNode& node = scene.node(id);
        const double sse = screenSpaceError(node.bounds, node.geometricError, view);
        const double distance = length(view.position - node.bounds.center());
        const bool split = node.childCount > 0 && sse > config_.sseThresholdPixels;

        if (available.find(id) == available.end()) {
            const double depthBoost = 4'000.0 / static_cast<double>(node.depth + 1);
            const double priority =
                (current ? 1.0e9 : 0.0) +
                weight * (sse + 1.0) +
                depthBoost;
            auto found = requestMap.find(id);
            if (found == requestMap.end() || priority > found->second.priority) {
                requestMap[id] = RequestItem{id, priority, sse, split, !current};
            }
        }

        if (split) {
            for (std::uint32_t child : scene.children(id)) {
                visit(child, view, weight, current);
            }
            return;
        }
        if (current) {
            desired.push_back(DesiredNode{id, sse, distance});
        }
    };

    visit(0, camera, 1.0, true);
    const std::size_t lookaheadCount =
        std::min(lookaheadCameras.size(), config_.maxLookaheadCameras);
    for (std::size_t index = 0; index < lookaheadCount; ++index) {
        const double weight = 0.65 / static_cast<double>(index + 1);
        visit(0, lookaheadCameras[index], weight, false);
    }
    plan.requiredFrontier = desired.size();
    for (const DesiredNode& node : desired) {
        if (gpuReady.find(node.id) == gpuReady.end()) {
            ++plan.missingChunks;
        }
    }

    std::function<void(std::uint32_t, double, double)> renderNode;
    renderNode = [&](std::uint32_t id, double sse, double distance) {
        const DiskNode& node = scene.node(id);
        const bool split = node.childCount > 0 && sse > config_.sseThresholdPixels;
        bool allChildrenReady = split;
        if (split) {
            for (std::uint32_t child : scene.children(id)) {
                if (gpuReady.find(child) == gpuReady.end()) {
                    allChildrenReady = false;
                    break;
                }
            }
        }

        if (split && allChildrenReady) {
            for (std::uint32_t child : scene.children(id)) {
                const DiskNode& childNode = scene.node(child);
                const double childSse =
                    screenSpaceError(childNode.bounds, childNode.geometricError, camera);
                const double childDistance =
                    length(camera.position - childNode.bounds.center());
                renderNode(child, childSse, childDistance);
            }
            return;
        }

        if (gpuReady.find(id) != gpuReady.end()) {
            plan.render.push_back(RenderItem{
                id, sse, distance, node.depth, split && !allChildrenReady});
        }
    };

    const DiskNode& root = scene.node(0);
    renderNode(0,
               screenSpaceError(root.bounds, root.geometricError, camera),
               length(camera.position - root.bounds.center()));

    plan.duplicateNodes = countDuplicateRenderedNodes(scene, plan.render);
    plan.requests.reserve(requestMap.size());
    for (auto& [id, item] : requestMap) {
        (void)id;
        plan.requests.push_back(item);
    }
    std::sort(plan.requests.begin(), plan.requests.end(),
              [](const RequestItem& left, const RequestItem& right) {
                  if (left.priority != right.priority) {
                      return left.priority > right.priority;
                  }
                  return left.nodeId < right.nodeId;
              });
    return plan;
}

std::uint64_t FramePlanner::countDuplicateRenderedNodes(
    const SceneIndex& scene,
    const std::vector<RenderItem>& rendered) {
    std::unordered_set<std::uint32_t> visible;
    visible.reserve(rendered.size() * 2 + 1);
    for (const RenderItem& item : rendered) {
        visible.insert(item.nodeId);
    }
    std::uint64_t duplicates = 0;
    for (const RenderItem& item : rendered) {
        std::uint32_t parent = scene.node(item.nodeId).parent;
        while (parent != kInvalidNode) {
            if (visible.find(parent) != visible.end()) {
                ++duplicates;
            }
            parent = scene.node(parent).parent;
        }
    }
    return duplicates;
}

}  // namespace pcloud
