#include "core/ChunkReader.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <thread>

namespace pcloud {

class ChunkReader::DiskThrottle {
public:
    explicit DiskThrottle(std::uint64_t bytesPerSecond)
        : bytesPerSecond_(bytesPerSecond),
          nextSlot_(std::chrono::steady_clock::now()) {}

    void setBytesPerSecond(std::uint64_t bytesPerSecond) {
        std::lock_guard<std::mutex> lock(mutex_);
        bytesPerSecond_ = bytesPerSecond;
        nextSlot_ = std::chrono::steady_clock::now();
        changed_.notify_all();
    }

    void wakeAll() {
        std::lock_guard<std::mutex> lock(mutex_);
        changed_.notify_all();
    }

    std::uint64_t acquire(std::uint64_t bytes, const std::atomic<bool>& stop) {
        const auto started = std::chrono::steady_clock::now();
        std::unique_lock<std::mutex> lock(mutex_);
        if (bytesPerSecond_ == 0) {
            return 0;
        }

        auto availableAt = std::max(std::chrono::steady_clock::now(), nextSlot_);
        const double seconds =
            static_cast<double>(bytes) / static_cast<double>(bytesPerSecond_);
        const auto duration = std::chrono::duration_cast<std::chrono::steady_clock::duration>(
            std::chrono::duration<double>(seconds));
        nextSlot_ = availableAt + duration;

        changed_.wait_until(lock, availableAt, [&stop] {
            return stop.load(std::memory_order_acquire);
        });
        const auto elapsed = std::chrono::steady_clock::now() - started;
        return static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count());
    }

private:
    std::mutex mutex_;
    std::condition_variable changed_;
    std::uint64_t bytesPerSecond_ = 0;
    std::chrono::steady_clock::time_point nextSlot_;
};

ChunkReader::ChunkReader(std::shared_ptr<const SceneIndex> scene,
                         std::uint64_t diskBytesPerSecond,
                         int readerThreads)
    : scene_(std::move(scene)),
      throttle_(std::make_unique<DiskThrottle>(diskBytesPerSecond)) {
    const int count = std::clamp(readerThreads, 1, 8);
    workers_.reserve(static_cast<std::size_t>(count));
    for (int index = 0; index < count; ++index) {
        workers_.emplace_back([this] { workerLoop(); });
    }
}

ChunkReader::~ChunkReader() {
    close();
}

bool ChunkReader::request(std::uint32_t nodeId, double priority, ChunkCallback callback) {
    if (!scene_ || nodeId >= scene_->nodeCount() ||
        stopped_.load(std::memory_order_acquire)) {
        return false;
    }
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stopped_.load(std::memory_order_relaxed) ||
            inFlight_.find(nodeId) != inFlight_.end()) {
            return false;
        }
        inFlight_.insert(nodeId);
        jobs_.push_back(Job{nodeId, priority, nextSequence_++, std::move(callback)});
        std::push_heap(jobs_.begin(), jobs_.end(), JobLess{});
    }
    requests_.fetch_add(1, std::memory_order_relaxed);
    workAvailable_.notify_one();
    return true;
}

void ChunkReader::setDiskBytesPerSecond(std::uint64_t bytesPerSecond) {
    throttle_->setBytesPerSecond(bytesPerSecond);
}

void ChunkReader::close() {
    if (stopped_.exchange(true, std::memory_order_acq_rel)) {
        return;
    }
    throttle_->wakeAll();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobs_.clear();
    }
    workAvailable_.notify_all();
    for (auto& worker : workers_) {
        if (worker.joinable()) {
            worker.join();
        }
    }
    workers_.clear();
}

ChunkReaderStats ChunkReader::stats() const {
    ChunkReaderStats snapshot;
    snapshot.requests = requests_.load(std::memory_order_relaxed);
    snapshot.completed = completed_.load(std::memory_order_relaxed);
    snapshot.failed = failed_.load(std::memory_order_relaxed);
    snapshot.bytesRead = bytesRead_.load(std::memory_order_relaxed);
    snapshot.totalThrottleWaitMs = throttleWaitMs_.load(std::memory_order_relaxed);
    snapshot.totalReadMs = readMs_.load(std::memory_order_relaxed);
    std::lock_guard<std::mutex> lock(mutex_);
    snapshot.inFlight = inFlight_.size();
    snapshot.queued = jobs_.size();
    return snapshot;
}

void ChunkReader::workerLoop() {
    while (true) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            workAvailable_.wait(lock, [this] {
                return stopped_.load(std::memory_order_acquire) || !jobs_.empty();
            });
            if (stopped_.load(std::memory_order_acquire)) {
                return;
            }
            std::pop_heap(jobs_.begin(), jobs_.end(), JobLess{});
            job = std::move(jobs_.back());
            jobs_.pop_back();
        }

        ChunkResult result = readChunk(job);
        {
            std::lock_guard<std::mutex> lock(mutex_);
            inFlight_.erase(job.nodeId);
        }
        if (stopped_.load(std::memory_order_acquire)) {
            continue;
        }
        if (result.ok) {
            completed_.fetch_add(1, std::memory_order_relaxed);
        } else {
            failed_.fetch_add(1, std::memory_order_relaxed);
        }
        throttleWaitMs_.fetch_add(result.throttleWaitMs, std::memory_order_relaxed);
        readMs_.fetch_add(result.readMs, std::memory_order_relaxed);
        if (job.callback) {
            try {
                job.callback(std::move(result));
            } catch (...) {
                failed_.fetch_add(1, std::memory_order_relaxed);
            }
        }
    }
}

ChunkResult ChunkReader::readChunk(const Job& job) {
    ChunkResult result;
    result.nodeId = job.nodeId;
    if (!scene_ || job.nodeId >= scene_->nodeCount()) {
        result.error = "unknown node";
        return result;
    }
    const DiskNode& node = scene_->node(job.nodeId);
    result.throttleWaitMs = throttle_->acquire(node.payloadBytes, stopped_);
    if (stopped_.load(std::memory_order_acquire)) {
        result.error = "reader stopped";
        return result;
    }

    const auto readStarted = std::chrono::steady_clock::now();
    std::ifstream input(scene_->path(), std::ios::binary);
    if (!input) {
        result.error = "cannot open scene";
        return result;
    }
    input.seekg(static_cast<std::streamoff>(node.payloadOffset), std::ios::beg);
    if (!input) {
        result.error = "cannot seek to chunk";
        return result;
    }
    result.points.resize(node.pointCount);
    input.read(reinterpret_cast<char*>(result.points.data()),
               static_cast<std::streamsize>(node.payloadBytes));
    if (!input) {
        result.error = "truncated chunk";
        result.points.clear();
        return result;
    }

    bytesRead_.fetch_add(node.payloadBytes, std::memory_order_relaxed);
    result.readMs = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - readStarted)
            .count());
    result.ok = true;
    return result;
}

}  // namespace pcloud
