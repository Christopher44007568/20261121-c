#pragma once

#include "core/SceneFormat.h"

#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace pcloud {

struct BufferPoolEntry {
    std::uint32_t nodeId = kInvalidNode;
    std::uint64_t bytes = 0;
    std::uint64_t lastUseFrame = 0;
    std::uint32_t pins = 0;
    bool cpuReady = false;
    bool gpuReady = false;
};

struct BufferPoolStats {
    std::uint64_t gpuBytes = 0;
    std::uint64_t peakGpuBytes = 0;
    std::uint64_t evictions = 0;
    std::uint64_t blockedEvictionCandidates = 0;
    std::size_t cpuResident = 0;
    std::size_t gpuResident = 0;
    std::size_t pinned = 0;
};

struct EvictionResult {
    std::vector<std::uint32_t> evicted;
    std::uint64_t bytesFreed = 0;
    std::size_t blockedByPins = 0;
    bool fits = false;
};

class BufferPool {
public:
    explicit BufferPool(std::uint64_t maxGpuBytes = 0) : maxGpuBytes_(maxGpuBytes) {}

    bool addCpu(std::uint32_t nodeId, std::uint64_t bytes);
    bool commitGpu(std::uint32_t nodeId);
    bool remove(std::uint32_t nodeId);

    void beginFrame(std::uint64_t frame);
    bool pin(std::uint32_t nodeId);
    void unpin(std::uint32_t nodeId);
    void unpinAll();

    EvictionResult evictFor(std::uint64_t requiredBytes,
                            std::uint64_t maxGpuBytes,
                            std::uint64_t frame);

    bool contains(std::uint32_t nodeId) const;
    bool isCpuReady(std::uint32_t nodeId) const;
    bool isGpuReady(std::uint32_t nodeId) const;
    std::uint64_t gpuBytes() const { return gpuBytes_; }
    std::uint64_t peakGpuBytes() const { return peakGpuBytes_; }
    std::uint64_t maxGpuBytes() const { return maxGpuBytes_; }
    void setMaxGpuBytes(std::uint64_t value) { maxGpuBytes_ = value; }
    std::uint64_t currentFrame() const { return currentFrame_; }

    std::unordered_set<std::uint32_t> availableIds() const;
    std::unordered_set<std::uint32_t> gpuReadyIds() const;
    const BufferPoolEntry* entry(std::uint32_t nodeId) const;
    BufferPoolStats stats() const;

private:
    std::unordered_map<std::uint32_t, BufferPoolEntry> entries_;
    std::unordered_set<std::uint32_t> pinnedIds_;
    std::uint64_t maxGpuBytes_ = 0;
    std::uint64_t gpuBytes_ = 0;
    std::uint64_t peakGpuBytes_ = 0;
    std::uint64_t evictions_ = 0;
    std::uint64_t blockedEvictionCandidates_ = 0;
    std::uint64_t currentFrame_ = 0;
};

}  // namespace pcloud
