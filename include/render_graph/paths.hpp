#pragma once

#include <cstdint>
#include <string>

#include "render_graph/render_graph.hpp"

namespace rg {

enum class RenderPath {
    Shadow,
    PostProcess,
    Screenshot,
};

std::string path_name(RenderPath path);
std::string path_description(RenderPath path);
Graph build_path(RenderPath path, std::uint32_t width, std::uint32_t height);
std::string final_image_resource(RenderPath path);
std::string screenshot_buffer_resource();

}  // namespace rg
