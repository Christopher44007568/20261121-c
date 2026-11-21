#pragma once

#include <cstdint>
#include <string>

namespace pcloud {

struct SceneGenerationConfig {
    std::uint64_t pointCount = 300'000;
    int maxDepth = 6;
    std::uint32_t nodePointLimit = 4096;
    std::uint64_t seed = 7;
    double halfExtent = 16.0;
};

struct SceneGenerationResult {
    std::uint64_t nodeCount = 0;
    std::uint64_t storedPointCount = 0;
    std::uint64_t fileBytes = 0;
    int maxDepth = 0;
};

class SceneGenerator {
public:
    static bool generate(const SceneGenerationConfig& config,
                         const std::string& outputPath,
                         SceneGenerationResult* result,
                         std::string* error);
};

}  // namespace pcloud
