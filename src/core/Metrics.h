#pragma once

#include "core/ChunkReader.h"

#include <cstdint>
#include <mutex>

namespace pcloud {

struct FrameTelemetry {
    std::uint64_t missingChunks = 0;
    std::uint64_t duplicateNodes = 0;
    std::uint64_t requiredFrontier = 0;
    std::uint64_t visibleNodes = 0;
    std::uint64_t fallbackNodes = 0;
    std::uint64_t gpuBytes = 0;
    std::uint64_t gpuPeakBytes = 0;
    std::uint64_t gpuLimitBytes = 0;
    std::uint64_t uploads = 0;
    std::uint64_t evictions = 0;
    std::uint64_t blockedEvictions = 0;
    std::uint64_t requestsQueued = 0;
    std::size_t cpuResident = 0;
    std::size_t gpuResident = 0;
};

struct MetricsSnapshot {
    std::uint64_t frames = 0;
    std::uint64_t missingNodeFrames = 0;
    std::uint64_t duplicateNodeFrames = 0;
    std::uint64_t framesWithMissing = 0;
    std::uint64_t framesWithDuplicates = 0;
    std::uint64_t maxMissingInFrame = 0;
    std::uint64_t maxDuplicatesInFrame = 0;
    std::uint64_t lastMissing = 0;
    std::uint64_t lastDuplicates = 0;
    std::uint64_t lastVisible = 0;
    std::uint64_t lastFallback = 0;
    std::uint64_t lastRequiredFrontier = 0;
    std::uint64_t gpuBytes = 0;
    std::uint64_t gpuPeakBytes = 0;
    std::uint64_t gpuLimitBytes = 0;
    std::uint64_t uploads = 0;
    std::uint64_t evictions = 0;
    std::uint64_t blockedEvictions = 0;
    std::size_t cpuResident = 0;
    std::size_t gpuResident = 0;
    ChunkReaderStats io;
};

class MetricsCollector {
public:
    void reset();
    void recordFrame(const FrameTelemetry& frame);
    void setIoStats(const ChunkReaderStats& io);
    MetricsSnapshot snapshot() const;

private:
    mutable std::mutex mutex_;
    MetricsSnapshot snapshot_;
};

}  // namespace pcloud
