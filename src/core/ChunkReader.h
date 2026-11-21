#pragma once

#include "core/Geometry.h"
#include "core/SceneIndex.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

namespace pcloud {

struct ChunkResult {
    std::uint32_t nodeId = kInvalidNode;
    std::vector<Point> points;
    std::uint64_t throttleWaitMs = 0;
    std::uint64_t readMs = 0;
    bool ok = false;
    std::string error;
};

using ChunkCallback = std::function<void(ChunkResult)>;

struct ChunkReaderStats {
    std::uint64_t requests = 0;
    std::uint64_t completed = 0;
    std::uint64_t failed = 0;
    std::uint64_t bytesRead = 0;
    std::uint64_t totalThrottleWaitMs = 0;
    std::uint64_t totalReadMs = 0;
    std::size_t inFlight = 0;
    std::size_t queued = 0;
};

class ChunkReader {
public:
    ChunkReader(std::shared_ptr<const SceneIndex> scene,
                std::uint64_t diskBytesPerSecond,
                int readerThreads);
    ~ChunkReader();

    ChunkReader(const ChunkReader&) = delete;
    ChunkReader& operator=(const ChunkReader&) = delete;

    bool request(std::uint32_t nodeId, double priority, ChunkCallback callback);
    void setDiskBytesPerSecond(std::uint64_t bytesPerSecond);
    void close();

    ChunkReaderStats stats() const;
    bool isClosed() const { return stopped_.load(std::memory_order_acquire); }

private:
    struct Job {
        std::uint32_t nodeId = kInvalidNode;
        double priority = 0.0;
        std::uint64_t sequence = 0;
        ChunkCallback callback;
    };

    struct JobLess {
        bool operator()(const Job& left, const Job& right) const {
            if (left.priority != right.priority) {
                return left.priority < right.priority;
            }
            return left.sequence > right.sequence;
        }
    };

    class DiskThrottle;

    void workerLoop();
    ChunkResult readChunk(const Job& job);

    std::shared_ptr<const SceneIndex> scene_;
    std::unique_ptr<DiskThrottle> throttle_;
    std::vector<std::thread> workers_;
    mutable std::mutex mutex_;
    std::condition_variable workAvailable_;
    std::vector<Job> jobs_;
    std::unordered_set<std::uint32_t> inFlight_;
    std::uint64_t nextSequence_ = 0;
    std::atomic<bool> stopped_{false};
    std::atomic<std::uint64_t> requests_{0};
    std::atomic<std::uint64_t> completed_{0};
    std::atomic<std::uint64_t> failed_{0};
    std::atomic<std::uint64_t> bytesRead_{0};
    std::atomic<std::uint64_t> throttleWaitMs_{0};
    std::atomic<std::uint64_t> readMs_{0};
};

}  // namespace pcloud
