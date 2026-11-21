#include "core/StressRunner.h"

#include "core/BufferPool.h"
#include "core/CameraPath.h"
#include "core/ChunkReader.h"
#include "core/FramePlanner.h"
#include "core/SceneIndex.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

namespace pcloud {
namespace {

constexpr double kMegabyte = 1024.0 * 1024.0;

std::uint64_t megabytesToBytes(double megabytes) {
    if (megabytes <= 0.0) {
        return 0;
    }
    return static_cast<std::uint64_t>(megabytes * kMegabyte);
}

void writeCsvHeader(std::ostream& output) {
    output
        << "frame,path_seconds,required_frontier,missing_chunks,duplicate_nodes,"
        << "visible_nodes,fallback_nodes,uploads,evictions,blocked_evictions,"
        << "gpu_bytes,gpu_peak_bytes,gpu_limit_bytes,cpu_resident,gpu_resident,"
        << "queued_requests\n";
}

void writeCsvRow(std::ostream& output, const StressFrameRecord& row) {
    output << row.frame << ',' << std::fixed << std::setprecision(4) << row.pathSeconds << ','
           << row.requiredFrontier << ',' << row.missingChunks << ',' << row.duplicateNodes << ','
           << row.visibleNodes << ',' << row.fallbackNodes << ',' << row.uploads << ','
           << row.evictions << ',' << row.blockedEvictions << ',' << row.gpuBytes << ','
           << row.gpuPeakBytes << ',' << row.gpuLimitBytes << ',' << row.cpuResident << ','
           << row.gpuResident << ',' << row.queuedRequests << '\n';
}

std::vector<std::uint32_t> pendingUploads(const BufferPool& pool,
                                          const SceneIndex& scene) {
    std::vector<std::uint32_t> ids;
    for (std::uint32_t id : pool.availableIds()) {
        if (!pool.isGpuReady(id)) {
            ids.push_back(id);
        }
    }
    std::sort(ids.begin(), ids.end(), [&scene](std::uint32_t left, std::uint32_t right) {
        const std::uint8_t leftDepth = scene.node(left).depth;
        const std::uint8_t rightDepth = scene.node(right).depth;
        if (leftDepth != rightDepth) {
            return leftDepth < rightDepth;
        }
        return left < right;
    });
    return ids;
}

}  // namespace

bool StressRunner::run(const StressConfig& config,
                       StressResult& result,
                       std::string* error,
                       const ProgressCallback& progress) {
    if (config.scenePath.empty() || config.frames <= 0 || config.fps <= 0.0) {
        if (error) {
            *error = "stress requires a scene, positive frame count and fps";
        }
        return false;
    }
    auto scene = SceneIndex::open(config.scenePath, error);
    if (!scene) {
        return false;
    }

    const std::uint64_t gpuLimit = megabytesToBytes(config.vramMegabytes);
    const std::uint64_t diskRate =
        static_cast<std::uint64_t>(std::max(0.0, config.diskMegabytesPerSecond) * kMegabyte);
    CameraPath path = CameraPath::orbitAround(scene->header().bounds, config.pathDurationSeconds);
    FramePlanner planner(PlannerConfig{config.sseThresholdPixels, 32'768, 6});
    BufferPool pool(gpuLimit);
    MetricsCollector metrics;

    std::mutex chunkMutex;
    std::vector<ChunkResult> completedChunks;
    std::unordered_set<std::uint32_t> requestedChunks;
    ChunkReader reader(scene, diskRate, config.readerThreads);

    std::ofstream csv;
    bool wroteCsv = false;
    if (!config.csvPath.empty()) {
        csv.open(config.csvPath, std::ios::out | std::ios::trunc);
        if (!csv) {
            if (error) {
                *error = "cannot create stress CSV";
            }
            reader.close();
            return false;
        }
        writeCsvHeader(csv);
        wroteCsv = true;
    }

    const auto started = std::chrono::steady_clock::now();
    const double frameSeconds = 1.0 / config.fps;
    std::uint64_t previousEvictions = 0;
    std::uint64_t previousBlocked = 0;

    for (int frameIndex = 0; frameIndex < config.frames; ++frameIndex) {
        const auto frameStarted = std::chrono::steady_clock::now();
        const double pathSeconds = static_cast<double>(frameIndex) / config.fps;
        const CameraView camera = path.at(
            pathSeconds, 900, 45.0);
        const std::vector<CameraView> lookahead = path.lookahead(
            pathSeconds, 4, 0.65, 900, 45.0);

        pool.beginFrame(static_cast<std::uint64_t>(frameIndex));
        const FramePlan plan = planner.plan(
            *scene, camera, pool.gpuReadyIds(), pool.availableIds(), lookahead);
        for (const RenderItem& render : plan.render) {
            pool.pin(render.nodeId);
        }

        {
            std::lock_guard<std::mutex> lock(chunkMutex);
            for (ChunkResult& chunk : completedChunks) {
                if (chunk.ok) {
                    pool.addCpu(chunk.nodeId, chunk.points.size() * sizeof(Point));
                }
            }
            completedChunks.clear();
        }

        std::uint64_t uploadsThisFrame = 0;
        if (gpuLimit != 0 && pool.gpuBytes() > gpuLimit) {
            pool.evictFor(0, gpuLimit, static_cast<std::uint64_t>(frameIndex));
        }
        for (std::uint32_t id : pendingUploads(pool, *scene)) {
            const BufferPoolEntry* entry = pool.entry(id);
            if (!entry) {
                continue;
            }
            const std::uint64_t required = entry->bytes;
            if (gpuLimit != 0 && pool.gpuBytes() + required > gpuLimit) {
                const EvictionResult eviction =
                    pool.evictFor(required, gpuLimit, static_cast<std::uint64_t>(frameIndex));
                if (!eviction.fits) {
                    continue;
                }
            }
            if (pool.commitGpu(id)) {
                ++uploadsThisFrame;
            }
        }

        const BufferPoolStats poolStats = pool.stats();
        const ChunkReaderStats ioStats = reader.stats();
        FrameTelemetry telemetry;
        telemetry.missingChunks = plan.missingChunks;
        telemetry.duplicateNodes = plan.duplicateNodes;
        telemetry.requiredFrontier = plan.requiredFrontier;
        telemetry.visibleNodes = plan.render.size();
        telemetry.fallbackNodes = static_cast<std::uint64_t>(std::count_if(
            plan.render.begin(), plan.render.end(),
            [](const RenderItem& item) { return item.fallback; }));
        telemetry.gpuBytes = poolStats.gpuBytes;
        telemetry.gpuPeakBytes = poolStats.peakGpuBytes;
        telemetry.gpuLimitBytes = gpuLimit;
        telemetry.uploads = uploadsThisFrame;
        telemetry.evictions = poolStats.evictions - previousEvictions;
        telemetry.blockedEvictions =
            poolStats.blockedEvictionCandidates - previousBlocked;
        telemetry.requestsQueued = ioStats.queued + ioStats.inFlight;
        telemetry.cpuResident = poolStats.cpuResident;
        telemetry.gpuResident = poolStats.gpuResident;
        metrics.recordFrame(telemetry);
        metrics.setIoStats(ioStats);
        previousEvictions = poolStats.evictions;
        previousBlocked = poolStats.blockedEvictionCandidates;

        StressFrameRecord row;
        row.frame = static_cast<std::uint64_t>(frameIndex);
        row.pathSeconds = pathSeconds;
        row.requiredFrontier = telemetry.requiredFrontier;
        row.missingChunks = telemetry.missingChunks;
        row.duplicateNodes = telemetry.duplicateNodes;
        row.visibleNodes = static_cast<std::size_t>(telemetry.visibleNodes);
        row.fallbackNodes = static_cast<std::size_t>(telemetry.fallbackNodes);
        row.uploads = uploadsThisFrame;
        row.evictions = telemetry.evictions;
        row.blockedEvictions = telemetry.blockedEvictions;
        row.gpuBytes = telemetry.gpuBytes;
        row.gpuPeakBytes = telemetry.gpuPeakBytes;
        row.gpuLimitBytes = telemetry.gpuLimitBytes;
        row.cpuResident = telemetry.cpuResident;
        row.gpuResident = telemetry.gpuResident;
        row.queuedRequests = telemetry.requestsQueued;
        if (csv) {
            writeCsvRow(csv, row);
        }
        if (progress) {
            progress(row);
        }

        for (const RequestItem& request : plan.requests) {
            {
                std::lock_guard<std::mutex> lock(chunkMutex);
                if (requestedChunks.find(request.nodeId) != requestedChunks.end() ||
                    pool.contains(request.nodeId)) {
                    continue;
                }
                requestedChunks.insert(request.nodeId);
            }
            const bool accepted = reader.request(
                request.nodeId, request.priority, [&](ChunkResult chunk) {
                    std::lock_guard<std::mutex> lock(chunkMutex);
                    requestedChunks.erase(chunk.nodeId);
                    completedChunks.push_back(std::move(chunk));
                });
            if (!accepted) {
                std::lock_guard<std::mutex> lock(chunkMutex);
                requestedChunks.erase(request.nodeId);
            }
        }
        pool.unpinAll();

        if (config.realtime) {
            const auto deadline = frameStarted + std::chrono::duration_cast<
                                                     std::chrono::steady_clock::duration>(
                                                     std::chrono::duration<double>(frameSeconds));
            std::this_thread::sleep_until(deadline);
        }
    }

    reader.close();
    const double elapsed = std::chrono::duration<double>(
                               std::chrono::steady_clock::now() - started)
                               .count();
    metrics.setIoStats(reader.stats());
    result.framesRun = config.frames;
    result.elapsedSeconds = elapsed;
    result.metrics = metrics.snapshot();
    result.sceneNodes = scene->nodeCount();
    result.sceneBytes = scene->header().fileSize;
    result.wroteCsv = wroteCsv;
    if (csv) {
        csv.flush();
    }
    return true;
}

}  // namespace pcloud
