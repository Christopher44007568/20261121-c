#include "core/BufferPool.h"
#include "core/CameraPath.h"
#include "core/ChunkReader.h"
#include "core/FramePlanner.h"
#include "core/SceneGenerator.h"
#include "core/SceneIndex.h"
#include "core/StressRunner.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

namespace {

int failures = 0;

void check(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        ++failures;
    }
}

template <typename T>
bool contains(const std::vector<T>& values, const T& value) {
    for (const T& candidate : values) {
        if (candidate == value) {
            return true;
        }
    }
    return false;
}

bool rendersNode(const pcloud::FramePlan& plan, std::uint32_t nodeId) {
    for (const pcloud::RenderItem& item : plan.render) {
        if (item.nodeId == nodeId) {
            return true;
        }
    }
    return false;
}

std::filesystem::path temporaryScenePath() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::filesystem::temp_directory_path() /
           ("pcloud_core_tests_" + std::to_string(stamp) + ".pcloud");
}

void testSceneRoundTrip(const std::filesystem::path& path) {
    pcloud::SceneGenerationConfig config;
    config.pointCount = 20'000;
    config.maxDepth = 5;
    config.nodePointLimit = 512;
    config.seed = 42;
    config.halfExtent = 8.0;
    pcloud::SceneGenerationResult generated;
    std::string error;
    check(pcloud::SceneGenerator::generate(
              config, path.string(), &generated, &error),
          "scene generation: " + error);
    check(generated.nodeCount > 8, "generated octree has multiple levels");
    check(generated.maxDepth >= 2, "generated scene reaches depth 2");

    auto scene = pcloud::SceneIndex::open(path.string(), &error);
    check(scene != nullptr, "scene opens after writing: " + error);
    if (!scene) {
        return;
    }
    check(scene->nodeCount() == generated.nodeCount, "node count round-trips");
    check(scene->header().fileSize == generated.fileBytes, "file size round-trips");
    check(std::filesystem::file_size(path) == generated.fileBytes,
          "index entries have the advertised 72-byte layout");
    check(scene->node(0).parent == pcloud::kInvalidNode, "root has no parent");
    check(std::abs(scene->node(0).bounds.min.x - scene->header().bounds.min.x) < 1e-4 &&
              std::abs(scene->node(0).bounds.max.y - scene->header().bounds.max.y) < 1e-4,
          "root bounds round-trip through the index");
    for (std::uint32_t id = 0; id < scene->nodeCount(); ++id) {
        const pcloud::DiskNode& node = scene->node(id);
        check(node.pointCount > 0, "node has a representative payload");
        check(node.payloadBytes == node.pointCount * sizeof(pcloud::Point),
              "payload size matches point count");
        if (node.parent != pcloud::kInvalidNode) {
            check(scene->isAncestor(node.parent, id), "parent relationship is valid");
        }
    }
}

void testChunkReader(const std::filesystem::path& path) {
    std::string error;
    auto scene = pcloud::SceneIndex::open(path.string(), &error);
    check(scene != nullptr, "chunk reader scene opens");
    if (!scene) {
        return;
    }
    pcloud::ChunkReader reader(scene, 0, 2);
    std::mutex mutex;
    std::condition_variable changed;
    std::atomic<int> completed{0};
    std::atomic<bool> payloadOk{true};
    const std::uint32_t sampleCount =
        static_cast<std::uint32_t>(std::min<std::size_t>(scene->nodeCount(), 12));
    for (std::uint32_t id = 0; id < sampleCount; ++id) {
        const bool accepted = reader.request(id, 100.0 - id, [&](pcloud::ChunkResult result) {
            if (!result.ok ||
                result.points.size() != scene->node(result.nodeId).pointCount) {
                payloadOk.store(false, std::memory_order_relaxed);
            }
            {
                std::lock_guard<std::mutex> lock(mutex);
                completed.fetch_add(1, std::memory_order_relaxed);
            }
            changed.notify_all();
        });
        check(accepted, "chunk request accepted");
    }
    {
        std::unique_lock<std::mutex> lock(mutex);
        changed.wait_for(lock, std::chrono::seconds(5), [&] {
            return completed.load(std::memory_order_relaxed) ==
                   static_cast<int>(sampleCount);
        });
    }
    check(completed.load(std::memory_order_relaxed) == static_cast<int>(sampleCount),
          "all requested chunks completed");
    check(payloadOk.load(std::memory_order_relaxed),
          "chunk payload matches index point count");
    reader.close();
}

void testPlanner(const std::filesystem::path& path) {
    std::string error;
    auto scene = pcloud::SceneIndex::open(path.string(), &error);
    check(scene != nullptr, "planner scene opens");
    if (!scene) {
        return;
    }
    pcloud::PlannerConfig config;
    config.sseThresholdPixels = 0.5;
    pcloud::FramePlanner planner(config);
    pcloud::CameraView camera;
    camera.position = {
        scene->header().bounds.center().x + 5.0,
        scene->header().bounds.center().y + 4.0,
        scene->header().bounds.center().z + 14.0,
    };
    camera.target = scene->header().bounds.center();
    camera.viewportHeight = 900;

    const std::unordered_set<std::uint32_t> none;
    const pcloud::FramePlan cold = planner.plan(*scene, camera, none, none);
    check(cold.render.empty(), "cold plan has no GPU-visible node");
    check(!cold.requests.empty(), "cold plan requests chunks");
    check(cold.missingChunks > 0, "cold plan records missing frontier chunks");
    check(cold.duplicateNodes == 0, "cold plan has no duplicate display");
    check(!cold.requests.empty() && cold.requests.front().nodeId == 0,
          "root chunk has highest request priority");

    std::unordered_set<std::uint32_t> rootOnly{0};
    const pcloud::FramePlan rootPlan =
        planner.plan(*scene, camera, rootOnly, rootOnly);
    check(rendersNode(rootPlan, 0),
          "ready root is used as the parent representation");
    check(rootPlan.duplicateNodes == 0, "root fallback has no duplicate display");

    std::unordered_set<std::uint32_t> children;
    children.insert(0);
    for (std::uint32_t child : scene->children(0)) {
        children.insert(child);
    }
    const pcloud::FramePlan childPlan =
        planner.plan(*scene, camera, children, children);
    check(!rendersNode(childPlan, 0) || children.size() == 1,
          "parent is replaced once all immediate children are ready");
    check(childPlan.duplicateNodes == 0,
          "ready child layer never renders with its ancestor");

    std::unordered_set<std::uint32_t> everyNode;
    for (std::uint32_t id = 0; id < scene->nodeCount(); ++id) {
        everyNode.insert(id);
    }
    const pcloud::FramePlan full = planner.plan(*scene, camera, everyNode, everyNode);
    check(!full.render.empty(), "fully resident scene renders nodes");
    check(full.duplicateNodes == 0, "fully resident scene has no duplicate display");
    check(pcloud::FramePlanner::countDuplicateRenderedNodes(*scene, full.render) == 0,
          "duplicate detector agrees with planner");

    std::vector<pcloud::RenderItem> injected = full.render;
    injected.push_back(pcloud::RenderItem{0, 0.0, 0.0, 0, false});
    check(pcloud::FramePlanner::countDuplicateRenderedNodes(*scene, injected) > 0,
          "duplicate detector catches ancestor and descendant");
}

void testFrameSafeBufferPool() {
    pcloud::BufferPool pool(100);
    pool.beginFrame(1);
    check(pool.addCpu(1, 40), "buffer pool accepts CPU node A");
    check(pool.addCpu(2, 30), "buffer pool accepts CPU node B");
    check(pool.commitGpu(1), "buffer pool uploads node A");
    check(pool.commitGpu(2), "buffer pool uploads node B");
    check(pool.gpuBytes() == 70, "buffer pool tracks GPU bytes");
    check(pool.pin(1), "visible node can be pinned");

    const pcloud::EvictionResult first = pool.evictFor(40, 100, 2);
    check(first.fits, "eviction fits after removing unpinned node");
    check(first.evicted == std::vector<std::uint32_t>{2},
          "eviction leaves the pinned node resident");
    check(pool.isGpuReady(1), "pinned current-frame buffer was not recycled");
    check(!pool.isGpuReady(2), "unpinned LRU buffer was recycled");

    const pcloud::EvictionResult blocked = pool.evictFor(80, 100, 2);
    check(!blocked.fits, "eviction cannot fit while the only candidate is pinned");
    check(blocked.blockedByPins > 0, "blocked eviction is counted");
    check(pool.isGpuReady(1), "blocked current-frame buffer remains safe");

    pool.unpinAll();
    const pcloud::EvictionResult second = pool.evictFor(80, 100, 3);
    check(second.fits, "eviction fits after current-frame unpin");
    check(second.evicted == std::vector<std::uint32_t>{1},
          "previous pinned node is recycled after frame release");
    check(pool.gpuBytes() == 0, "all GPU bytes released");
    check(pool.peakGpuBytes() == 70, "GPU buffer peak is recorded");
}

void testCameraPath() {
    const pcloud::Box3 bounds{{-8.0, -4.0, -8.0}, {8.0, 4.0, 8.0}};
    const pcloud::CameraPath path = pcloud::CameraPath::orbitAround(bounds, 12.0, 8);
    check(path.duration() == 12.0, "camera path duration");
    const pcloud::CameraView start = path.at(0.0);
    const pcloud::CameraView wrapped = path.at(12.0);
    check(pcloud::length(start.position - wrapped.position) < 1e-6,
          "camera path wraps at its duration");
    const auto ahead = path.lookahead(2.0, 4, 0.5);
    check(ahead.size() == 4, "camera path produces lookahead samples");
    for (const pcloud::CameraView& camera : ahead) {
        check(pcloud::length(camera.position - bounds.center()) > 1.0,
              "lookahead camera stays outside the scene center");
    }
}

void testStressRunner(const std::filesystem::path& path) {
    pcloud::StressConfig config;
    config.scenePath = path.string();
    config.frames = 24;
    config.fps = 120.0;
    config.sseThresholdPixels = 1.5;
    config.diskMegabytesPerSecond = 0.0;
    config.vramMegabytes = 0.04;
    config.readerThreads = 2;
    config.realtime = true;
    config.pathDurationSeconds = 5.0;
    pcloud::StressResult result;
    std::string error;
    check(pcloud::StressRunner::run(config, result, &error),
          "headless stress run completes: " + error);
    check(result.metrics.frames == 24, "stress records every frame");
    check(result.metrics.duplicateNodeFrames == 0,
          "stress detects no parent/child duplicate display");
    if (result.metrics.gpuLimitBytes != 0) {
        check(result.metrics.gpuPeakBytes <= result.metrics.gpuLimitBytes,
              "stress respects the GPU budget");
    }
    check(result.sceneNodes > 0, "stress reports scene node count");
}

}  // namespace

int main() {
    const std::filesystem::path scenePath = temporaryScenePath();
    try {
        testSceneRoundTrip(scenePath);
        testChunkReader(scenePath);
        testPlanner(scenePath);
        testFrameSafeBufferPool();
        testCameraPath();
        testStressRunner(scenePath);
    } catch (const std::exception& exception) {
        std::cerr << "FAIL: uncaught exception: " << exception.what() << '\n';
        ++failures;
    }
    std::error_code ignored;
    std::filesystem::remove(scenePath, ignored);
    if (failures == 0) {
        std::cout << "All core tests passed\n";
    }
    return failures == 0 ? 0 : 1;
}
