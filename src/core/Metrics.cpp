#include "core/Metrics.h"

#include <algorithm>

namespace pcloud {

void MetricsCollector::reset() {
    std::lock_guard<std::mutex> lock(mutex_);
    snapshot_ = MetricsSnapshot{};
}

void MetricsCollector::recordFrame(const FrameTelemetry& frame) {
    std::lock_guard<std::mutex> lock(mutex_);
    ++snapshot_.frames;
    snapshot_.missingNodeFrames += frame.missingChunks;
    snapshot_.duplicateNodeFrames += frame.duplicateNodes;
    snapshot_.framesWithMissing += frame.missingChunks > 0 ? 1 : 0;
    snapshot_.framesWithDuplicates += frame.duplicateNodes > 0 ? 1 : 0;
    snapshot_.maxMissingInFrame =
        std::max(snapshot_.maxMissingInFrame, frame.missingChunks);
    snapshot_.maxDuplicatesInFrame =
        std::max(snapshot_.maxDuplicatesInFrame, frame.duplicateNodes);
    snapshot_.lastMissing = frame.missingChunks;
    snapshot_.lastDuplicates = frame.duplicateNodes;
    snapshot_.lastVisible = frame.visibleNodes;
    snapshot_.lastFallback = frame.fallbackNodes;
    snapshot_.lastRequiredFrontier = frame.requiredFrontier;
    snapshot_.gpuBytes = frame.gpuBytes;
    snapshot_.gpuPeakBytes = std::max(snapshot_.gpuPeakBytes, frame.gpuPeakBytes);
    snapshot_.gpuPeakBytes = std::max(snapshot_.gpuPeakBytes, frame.gpuBytes);
    snapshot_.gpuLimitBytes = frame.gpuLimitBytes;
    snapshot_.uploads += frame.uploads;
    snapshot_.evictions += frame.evictions;
    snapshot_.blockedEvictions += frame.blockedEvictions;
    snapshot_.cpuResident = frame.cpuResident;
    snapshot_.gpuResident = frame.gpuResident;
}

void MetricsCollector::setIoStats(const ChunkReaderStats& io) {
    std::lock_guard<std::mutex> lock(mutex_);
    snapshot_.io = io;
}

MetricsSnapshot MetricsCollector::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return snapshot_;
}

}  // namespace pcloud
