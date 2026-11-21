#pragma once

#include "core/Metrics.h"

#include <cstdint>
#include <functional>
#include <string>

namespace pcloud {

struct StressConfig {
    std::string scenePath;
    std::string csvPath;
    int frames = 600;
    double fps = 30.0;
    double sseThresholdPixels = 6.0;
    double diskMegabytesPerSecond = 0.0;
    double vramMegabytes = 128.0;
    int readerThreads = 2;
    bool realtime = true;
    double pathDurationSeconds = 24.0;
};

struct StressFrameRecord {
    std::uint64_t frame = 0;
    double pathSeconds = 0.0;
    std::uint64_t requiredFrontier = 0;
    std::uint64_t missingChunks = 0;
    std::uint64_t duplicateNodes = 0;
    std::size_t visibleNodes = 0;
    std::size_t fallbackNodes = 0;
    std::uint64_t uploads = 0;
    std::uint64_t evictions = 0;
    std::uint64_t blockedEvictions = 0;
    std::uint64_t gpuBytes = 0;
    std::uint64_t gpuPeakBytes = 0;
    std::uint64_t gpuLimitBytes = 0;
    std::size_t cpuResident = 0;
    std::size_t gpuResident = 0;
    std::uint64_t queuedRequests = 0;
};

struct StressResult {
    int framesRun = 0;
    double elapsedSeconds = 0.0;
    MetricsSnapshot metrics;
    std::uint64_t sceneNodes = 0;
    std::uint64_t sceneBytes = 0;
    bool wroteCsv = false;
};

class StressRunner {
public:
    using ProgressCallback = std::function<void(const StressFrameRecord&)>;

    static bool run(const StressConfig& config,
                    StressResult& result,
                    std::string* error,
                    const ProgressCallback& progress = {});
};

}  // namespace pcloud
