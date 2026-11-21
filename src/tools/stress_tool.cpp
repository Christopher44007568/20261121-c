#include "core/StressRunner.h"

#include <charconv>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>
#include <string_view>

namespace {

bool parseU64(std::string_view text, std::uint64_t& value) {
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    return result.ec == std::errc{} && result.ptr == text.data() + text.size();
}

bool parseDouble(std::string_view text, double& value) {
    const std::string copy(text);
    char* end = nullptr;
    value = std::strtod(copy.c_str(), &end);
    return end != copy.c_str() && *end == '\0';
}

void usage() {
    std::cout
        << "Usage: pcloud_stress --scene scene.pcloud [options]\n"
        << "Options:\n"
        << "  --frames N          simulated frames (default 600)\n"
        << "  --duration S        override frames using duration * fps\n"
        << "  --fps F             simulation rate (default 30)\n"
        << "  --sse F             screen-space error threshold (default 6)\n"
        << "  --disk-mb-s F       throttled disk bandwidth, 0 = unlimited\n"
        << "  --vram-mb F         GPU residency budget, 0 = unlimited\n"
        << "  --threads N         disk reader threads (default 2)\n"
        << "  --csv FILE          write per-frame telemetry CSV\n"
        << "  --no-realtime       disable frame pacing (not for disk-throttle metrics)\n";
}

}  // namespace

int main(int argc, char** argv) {
    pcloud::StressConfig config;
    bool haveDuration = false;
    double duration = 0.0;

    for (int index = 1; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--help" || option == "-h") {
            usage();
            return 0;
        }
        if (option == "--no-realtime") {
            config.realtime = false;
            continue;
        }
        if (index + 1 >= argc) {
            std::cerr << "Missing value for " << option << '\n';
            return 2;
        }
        const std::string_view value(argv[++index]);
        bool ok = true;
        if (option == "--scene") {
            config.scenePath = value;
        } else if (option == "--csv") {
            config.csvPath = value;
        } else if (option == "--frames") {
            std::uint64_t frames = 0;
            ok = parseU64(value, frames);
            config.frames = static_cast<int>(frames);
        } else if (option == "--duration") {
            ok = parseDouble(value, duration);
            haveDuration = true;
        } else if (option == "--fps") {
            ok = parseDouble(value, config.fps);
        } else if (option == "--sse") {
            ok = parseDouble(value, config.sseThresholdPixels);
        } else if (option == "--disk-mb-s") {
            ok = parseDouble(value, config.diskMegabytesPerSecond);
        } else if (option == "--vram-mb") {
            ok = parseDouble(value, config.vramMegabytes);
        } else if (option == "--threads") {
            std::uint64_t threads = 0;
            ok = parseU64(value, threads);
            config.readerThreads = static_cast<int>(threads);
        } else {
            std::cerr << "Unknown option: " << option << '\n';
            return 2;
        }
        if (!ok) {
            std::cerr << "Invalid value for " << option << ": " << value << '\n';
            return 2;
        }
    }

    if (config.scenePath.empty()) {
        usage();
        return 2;
    }
    if (haveDuration) {
        config.frames =
            std::max(1, static_cast<int>(std::ceil(duration * config.fps)));
    }

    int lastReported = -1;
    pcloud::StressResult result;
    std::string error;
    const bool ok = pcloud::StressRunner::run(
        config, result, &error,
        [&](const pcloud::StressFrameRecord& frame) {
            const int second = config.fps > 0.0
                                   ? static_cast<int>(frame.frame / config.fps)
                                   : 0;
            if (second != lastReported && second % 2 == 0) {
                lastReported = second;
                std::cerr << "frame " << frame.frame
                          << " missing=" << frame.missingChunks
                          << " duplicates=" << frame.duplicateNodes
                          << " gpu=" << (frame.gpuBytes / (1024.0 * 1024.0)) << " MiB"
                          << " queued=" << frame.queuedRequests << '\n';
            }
        });
    if (!ok) {
        std::cerr << "Stress run failed: " << error << '\n';
        return 1;
    }

    const pcloud::MetricsSnapshot& metrics = result.metrics;
    std::cout << "{\n"
              << "  \"frames\": " << result.framesRun << ",\n"
              << "  \"elapsed_seconds\": " << result.elapsedSeconds << ",\n"
              << "  \"scene_nodes\": " << result.sceneNodes << ",\n"
              << "  \"scene_bytes\": " << result.sceneBytes << ",\n"
              << "  \"missing_node_frames\": " << metrics.missingNodeFrames << ",\n"
              << "  \"frames_with_missing\": " << metrics.framesWithMissing << ",\n"
              << "  \"max_missing_in_frame\": " << metrics.maxMissingInFrame << ",\n"
              << "  \"duplicate_node_frames\": " << metrics.duplicateNodeFrames << ",\n"
              << "  \"frames_with_duplicates\": " << metrics.framesWithDuplicates << ",\n"
              << "  \"gpu_peak_bytes\": " << metrics.gpuPeakBytes << ",\n"
              << "  \"gpu_limit_bytes\": " << metrics.gpuLimitBytes << ",\n"
              << "  \"uploads\": " << metrics.uploads << ",\n"
              << "  \"evictions\": " << metrics.evictions << ",\n"
              << "  \"blocked_evictions\": " << metrics.blockedEvictions << ",\n"
              << "  \"disk_bytes_read\": " << metrics.io.bytesRead << ",\n"
              << "  \"disk_throttle_wait_ms\": " << metrics.io.totalThrottleWaitMs << ",\n"
              << "  \"chunks_completed\": " << metrics.io.completed << ",\n"
              << "  \"chunks_failed\": " << metrics.io.failed << ",\n"
              << "  \"csv\": \"" << (result.wroteCsv ? config.csvPath : "") << "\"\n"
              << "}\n";
    return metrics.duplicateNodeFrames == 0 ? 0 : 3;
}
