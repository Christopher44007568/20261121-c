#include "core/SceneGenerator.h"

#include <charconv>
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
        << "Usage: pcloud_scene --out scene.pcloud [options]\n"
        << "Options:\n"
        << "  --points N          source points (default 300000)\n"
        << "  --depth N           max octree depth (default 6)\n"
        << "  --node-points N     payload cap per node (default 4096)\n"
        << "  --seed N            deterministic seed (default 7)\n"
        << "  --extent F          half scene extent (default 16)\n";
}

}  // namespace

int main(int argc, char** argv) {
    pcloud::SceneGenerationConfig config;
    std::string output;

    for (int index = 1; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--help" || option == "-h") {
            usage();
            return 0;
        }
        if (index + 1 >= argc) {
            std::cerr << "Missing value for " << option << '\n';
            return 2;
        }
        const std::string_view value(argv[++index]);
        bool ok = true;
        if (option == "--out") {
            output = value;
        } else if (option == "--points") {
            ok = parseU64(value, config.pointCount);
        } else if (option == "--depth") {
            std::uint64_t depth = 0;
            ok = parseU64(value, depth);
            config.maxDepth = static_cast<int>(depth);
        } else if (option == "--node-points") {
            std::uint64_t limit = 0;
            ok = parseU64(value, limit);
            config.nodePointLimit = static_cast<std::uint32_t>(limit);
        } else if (option == "--seed") {
            ok = parseU64(value, config.seed);
        } else if (option == "--extent") {
            ok = parseDouble(value, config.halfExtent);
        } else {
            std::cerr << "Unknown option: " << option << '\n';
            return 2;
        }
        if (!ok) {
            std::cerr << "Invalid value for " << option << ": " << value << '\n';
            return 2;
        }
    }

    if (output.empty()) {
        usage();
        return 2;
    }

    pcloud::SceneGenerationResult result;
    std::string error;
    if (!pcloud::SceneGenerator::generate(config, output, &result, &error)) {
        std::cerr << "Scene generation failed: " << error << '\n';
        return 1;
    }
    std::cout << "Wrote " << output << "\n"
              << "  nodes: " << result.nodeCount << "\n"
              << "  stored points: " << result.storedPointCount << "\n"
              << "  max depth: " << result.maxDepth << "\n"
              << "  bytes: " << result.fileBytes << '\n';
    return 0;
}
