#include "render_graph/paths.hpp"

#include <algorithm>
#include <utility>

namespace rg {
namespace {

ResourceAccess read(const std::string& resource,
                    AccessStage stage = AccessStage::Compute) {
    return {resource, AccessMode::Read, stage};
}

ResourceAccess write(const std::string& resource,
                     AccessStage stage = AccessStage::Compute) {
    return {resource, AccessMode::Write, stage};
}

PassDesc compute_pass(std::string name, std::string shader) {
    PassDesc pass;
    pass.name = std::move(name);
    pass.kind = PassKind::Compute;
    pass.shader = std::move(shader);
    return pass;
}

Graph shadow_graph(std::uint32_t width, std::uint32_t height) {
    Graph graph;
    graph.name = "shadow";
    graph.add_texture("shadow_map", Format::R32Float, width, height,
                      ResourceUsage::Storage | ResourceUsage::Sampled);
    graph.add_texture("lit_scene", Format::RGBA16Float, width, height,
                      ResourceUsage::Storage);

    auto receiver = compute_pass("shadow_receiver", "shadow_lighting.comp.spv");
    receiver.reads = {read("shadow_map")};
    receiver.writes = {write("lit_scene")};
    graph.add_pass(std::move(receiver));

    auto caster = compute_pass("shadow_caster", "shadow_caster.comp.spv");
    caster.writes = {write("shadow_map")};
    graph.add_pass(std::move(caster));
    return graph;
}

Graph postprocess_graph(std::uint32_t width, std::uint32_t height) {
    Graph graph;
    graph.name = "postprocess";
    graph.add_texture("hdr_scene", Format::RGBA16Float, width, height,
                      ResourceUsage::Storage);
    graph.add_texture("bloom_half", Format::RGBA16Float,
                      std::max(1u, width / 2), std::max(1u, height / 2),
                      ResourceUsage::Storage);
    graph.add_texture("ldr_frame", Format::RGBA8Unorm, width, height,
                      ResourceUsage::Storage);

    auto tonemap = compute_pass("tonemap", "tonemap.comp.spv");
    tonemap.reads = {read("hdr_scene"), read("bloom_half")};
    tonemap.writes = {write("ldr_frame")};
    graph.add_pass(std::move(tonemap));

    auto bloom = compute_pass("bloom_extract", "bloom.comp.spv");
    bloom.reads = {read("hdr_scene")};
    bloom.writes = {write("bloom_half")};
    graph.add_pass(std::move(bloom));

    auto scene = compute_pass("scene_lighting", "scene.comp.spv");
    scene.writes = {write("hdr_scene")};
    graph.add_pass(std::move(scene));
    return graph;
}

Graph screenshot_graph(std::uint32_t width, std::uint32_t height) {
    Graph graph;
    graph.name = "screenshot";
    graph.add_texture("shadow_map", Format::R32Float, width, height,
                      ResourceUsage::Storage | ResourceUsage::Sampled);
    graph.add_texture("hdr_scene", Format::RGBA16Float, width, height,
                      ResourceUsage::Storage);
    graph.add_texture("bloom_half", Format::RGBA16Float,
                      std::max(1u, width / 2), std::max(1u, height / 2),
                      ResourceUsage::Storage);
    graph.add_texture("ldr_frame", Format::RGBA8Unorm, width, height,
                      ResourceUsage::Storage | ResourceUsage::TransferSrc);
    graph.add_buffer(screenshot_buffer_resource(),
                     static_cast<std::uint64_t>(width) * height * 4,
                     ResourceUsage::TransferDst, ResourceFlags::Imported);

    auto capture = PassDesc{};
    capture.name = "screenshot_copy";
    capture.kind = PassKind::TransferImageToBuffer;
    capture.reads = {read("ldr_frame", AccessStage::Transfer)};
    capture.writes = {write(screenshot_buffer_resource(), AccessStage::Transfer)};
    graph.add_pass(std::move(capture));

    auto tonemap = compute_pass("tonemap", "tonemap.comp.spv");
    tonemap.reads = {read("hdr_scene"), read("bloom_half")};
    tonemap.writes = {write("ldr_frame")};
    graph.add_pass(std::move(tonemap));

    auto bloom = compute_pass("bloom_extract", "bloom.comp.spv");
    bloom.reads = {read("hdr_scene")};
    bloom.writes = {write("bloom_half")};
    graph.add_pass(std::move(bloom));

    auto receiver = compute_pass("shadow_receiver", "shadow_lighting.comp.spv");
    receiver.reads = {read("shadow_map")};
    receiver.writes = {write("hdr_scene")};
    graph.add_pass(std::move(receiver));

    auto caster = compute_pass("shadow_caster", "shadow_caster.comp.spv");
    caster.writes = {write("shadow_map")};
    graph.add_pass(std::move(caster));
    return graph;
}

}  // namespace

std::string path_name(RenderPath path) {
    switch (path) {
        case RenderPath::Shadow:
            return "shadow";
        case RenderPath::PostProcess:
            return "postprocess";
        case RenderPath::Screenshot:
            return "screenshot";
    }
    return "unknown";
}

std::string path_description(RenderPath path) {
    switch (path) {
        case RenderPath::Shadow:
            return "shadow map generation -> lit HDR scene";
        case RenderPath::PostProcess:
            return "HDR scene -> bloom extraction -> tone map";
        case RenderPath::Screenshot:
            return "full shadow + postprocess frame -> GPU image copy -> host readback";
    }
    return {};
}

Graph build_path(RenderPath path, std::uint32_t width, std::uint32_t height) {
    switch (path) {
        case RenderPath::Shadow:
            return shadow_graph(width, height);
        case RenderPath::PostProcess:
            return postprocess_graph(width, height);
        case RenderPath::Screenshot:
            return screenshot_graph(width, height);
    }
    return {};
}

std::string final_image_resource(RenderPath path) {
    switch (path) {
        case RenderPath::Shadow:
            return "lit_scene";
        case RenderPath::PostProcess:
            return "ldr_frame";
        case RenderPath::Screenshot:
            return "ldr_frame";
    }
    return {};
}

std::string screenshot_buffer_resource() {
    return "screenshot_bytes";
}

}  // namespace rg
