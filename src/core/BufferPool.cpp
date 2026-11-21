#include "core/BufferPool.h"

#include <algorithm>

namespace pcloud {

bool BufferPool::addCpu(std::uint32_t nodeId, std::uint64_t bytes) {
    if (nodeId == kInvalidNode || bytes == 0) {
        return false;
    }
    auto [iterator, inserted] =
        entries_.try_emplace(nodeId, BufferPoolEntry{nodeId, bytes});
    BufferPoolEntry& entry = iterator->second;
    if (entry.bytes != bytes && entry.gpuReady) {
        return false;
    }
    entry.bytes = bytes;
    entry.cpuReady = true;
    return inserted || !entry.gpuReady;
}

bool BufferPool::commitGpu(std::uint32_t nodeId) {
    auto iterator = entries_.find(nodeId);
    if (iterator == entries_.end() || !iterator->second.cpuReady) {
        return false;
    }
    BufferPoolEntry& entry = iterator->second;
    if (entry.gpuReady) {
        return true;
    }
    entry.gpuReady = true;
    entry.lastUseFrame = currentFrame_;
    gpuBytes_ += entry.bytes;
    peakGpuBytes_ = std::max(peakGpuBytes_, gpuBytes_);
    return true;
}

bool BufferPool::remove(std::uint32_t nodeId) {
    auto iterator = entries_.find(nodeId);
    if (iterator == entries_.end() || iterator->second.pins != 0) {
        return false;
    }
    if (iterator->second.gpuReady) {
        gpuBytes_ -= iterator->second.bytes;
    }
    entries_.erase(iterator);
    return true;
}

void BufferPool::beginFrame(std::uint64_t frame) {
    unpinAll();
    currentFrame_ = frame;
}

bool BufferPool::pin(std::uint32_t nodeId) {
    auto iterator = entries_.find(nodeId);
    if (iterator == entries_.end() || !iterator->second.gpuReady) {
        return false;
    }
    BufferPoolEntry& entry = iterator->second;
    if (entry.pins++ == 0) {
        pinnedIds_.insert(nodeId);
    }
    entry.lastUseFrame = currentFrame_;
    return true;
}

void BufferPool::unpin(std::uint32_t nodeId) {
    auto iterator = entries_.find(nodeId);
    if (iterator == entries_.end()) {
        return;
    }
    if (iterator->second.pins > 0) {
        if (--iterator->second.pins == 0) {
            pinnedIds_.erase(nodeId);
        }
    }
}

void BufferPool::unpinAll() {
    for (std::uint32_t nodeId : pinnedIds_) {
        auto iterator = entries_.find(nodeId);
        if (iterator != entries_.end()) {
            iterator->second.pins = 0;
        }
    }
    pinnedIds_.clear();
}

EvictionResult BufferPool::evictFor(std::uint64_t requiredBytes,
                                    std::uint64_t maxGpuBytes,
                                    std::uint64_t frame) {
    maxGpuBytes_ = maxGpuBytes;
    currentFrame_ = frame;
    EvictionResult result;
    if (maxGpuBytes == 0) {
        result.fits = true;
        return result;
    }
    if (gpuBytes_ + requiredBytes <= maxGpuBytes) {
        result.fits = true;
        return result;
    }

    std::vector<const BufferPoolEntry*> candidates;
    candidates.reserve(entries_.size());
    std::uint64_t evictableBytes = 0;
    for (const auto& [id, entry] : entries_) {
        (void)id;
        if (!entry.gpuReady) {
            continue;
        }
        if (entry.pins != 0) {
            ++result.blockedByPins;
            ++blockedEvictionCandidates_;
            continue;
        }
        candidates.push_back(&entry);
        evictableBytes += entry.bytes;
    }
    if (gpuBytes_ - evictableBytes + requiredBytes > maxGpuBytes) {
        return result;
    }
    std::sort(candidates.begin(), candidates.end(),
              [](const BufferPoolEntry* left, const BufferPoolEntry* right) {
                  if (left->lastUseFrame != right->lastUseFrame) {
                      return left->lastUseFrame < right->lastUseFrame;
                  }
                  return left->nodeId < right->nodeId;
              });

    for (const BufferPoolEntry* candidate : candidates) {
        if (gpuBytes_ + requiredBytes <= maxGpuBytes) {
            break;
        }
        const std::uint32_t id = candidate->nodeId;
        const std::uint64_t bytes = candidate->bytes;
        entries_.erase(id);
        gpuBytes_ -= bytes;
        result.bytesFreed += bytes;
        result.evicted.push_back(id);
        ++evictions_;
    }
    result.fits = gpuBytes_ + requiredBytes <= maxGpuBytes;
    return result;
}

bool BufferPool::contains(std::uint32_t nodeId) const {
    return entries_.find(nodeId) != entries_.end();
}

bool BufferPool::isCpuReady(std::uint32_t nodeId) const {
    auto iterator = entries_.find(nodeId);
    return iterator != entries_.end() && iterator->second.cpuReady;
}

bool BufferPool::isGpuReady(std::uint32_t nodeId) const {
    auto iterator = entries_.find(nodeId);
    return iterator != entries_.end() && iterator->second.gpuReady;
}

std::unordered_set<std::uint32_t> BufferPool::availableIds() const {
    std::unordered_set<std::uint32_t> result;
    result.reserve(entries_.size() * 2);
    for (const auto& [id, entry] : entries_) {
        if (entry.cpuReady) {
            result.insert(id);
        }
    }
    return result;
}

std::unordered_set<std::uint32_t> BufferPool::gpuReadyIds() const {
    std::unordered_set<std::uint32_t> result;
    result.reserve(entries_.size() * 2);
    for (const auto& [id, entry] : entries_) {
        if (entry.gpuReady) {
            result.insert(id);
        }
    }
    return result;
}

const BufferPoolEntry* BufferPool::entry(std::uint32_t nodeId) const {
    auto iterator = entries_.find(nodeId);
    return iterator == entries_.end() ? nullptr : &iterator->second;
}

BufferPoolStats BufferPool::stats() const {
    BufferPoolStats snapshot;
    snapshot.gpuBytes = gpuBytes_;
    snapshot.peakGpuBytes = peakGpuBytes_;
    snapshot.evictions = evictions_;
    snapshot.blockedEvictionCandidates = blockedEvictionCandidates_;
    snapshot.pinned = pinnedIds_.size();
    for (const auto& [id, entry] : entries_) {
        (void)id;
        snapshot.cpuResident += entry.cpuReady ? 1 : 0;
        snapshot.gpuResident += entry.gpuReady ? 1 : 0;
    }
    return snapshot;
}

}  // namespace pcloud
