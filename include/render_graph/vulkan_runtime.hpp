#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "render_graph/render_graph.hpp"

namespace rg {

struct VulkanRunOptions {
    std::string final_image;
    std::string ppm_path;
};

struct VulkanRunResult {
    bool success = false;
    std::string backend;
    std::string error;
    CompileResult compiled;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::vector<std::uint8_t> rgba8;
};

VulkanRunResult run_vulkan(const Graph& graph, const CompileResult& compiled,
                           const VulkanRunOptions& options);

}  // namespace rg
