#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "render_graph/paths.hpp"
#include "render_graph/render_graph.hpp"
#include "render_graph/vulkan_runtime.hpp"

namespace {

struct Options {
    std::string path = "all";
    std::string report_dir = "reports";
    std::string artifact_dir = "artifacts";
    std::uint32_t width = 640;
    std::uint32_t height = 360;
    bool vulkan = true;
};

void print_usage() {
    std::cout
        << "render_graph_demo [options]\n"
        << "  --path all|shadow|postprocess|screenshot  (default: all)\n"
        << "  --width N --height N                      (default: 640x360)\n"
        << "  --report-dir DIR                          (default: reports)\n"
        << "  --artifact-dir DIR                        (default: artifacts)\n"
        << "  --no-vulkan                               compile/report only\n"
        << "  --help\n";
}

bool parse_options(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        auto next = [&](std::string& value) {
            if (i + 1 >= argc) {
                std::cerr << "missing value for " << argument << "\n";
                return false;
            }
            value = argv[++i];
            return true;
        };
        if (argument == "--path") {
            if (!next(options.path)) {
                return false;
            }
        } else if (argument == "--report-dir") {
            if (!next(options.report_dir)) {
                return false;
            }
        } else if (argument == "--artifact-dir") {
            if (!next(options.artifact_dir)) {
                return false;
            }
        } else if (argument == "--width") {
            std::string value;
            if (!next(value)) {
                return false;
            }
            options.width = static_cast<std::uint32_t>(std::stoul(value));
        } else if (argument == "--height") {
            std::string value;
            if (!next(value)) {
                return false;
            }
            options.height = static_cast<std::uint32_t>(std::stoul(value));
        } else if (argument == "--no-vulkan") {
            options.vulkan = false;
        } else if (argument == "--help" || argument == "-h") {
            print_usage();
            std::exit(EXIT_SUCCESS);
        } else {
            std::cerr << "unknown argument: " << argument << "\n";
            return false;
        }
    }
    if (options.width == 0 || options.height == 0) {
        std::cerr << "width and height must be non-zero\n";
        return false;
    }
    return true;
}

bool write_file(const std::string& path, const std::string& contents) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        std::cerr << "cannot write " << path << "\n";
        return false;
    }
    output << contents;
    return static_cast<bool>(output);
}

void write_reports(const rg::CompileResult& result,
                   const std::string& report_dir, const std::string& stem) {
    write_file(report_dir + "/" + stem + ".md", rg::render_text(result));
    write_file(report_dir + "/" + stem + ".mmd", rg::render_mermaid(result));
    write_file(report_dir + "/" + stem + ".dot", rg::render_dot(result));
}

std::string checksum(const std::vector<std::uint8_t>& bytes) {
    std::uint64_t hash = 1469598103934665603ull;
    for (std::uint8_t byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    std::ostringstream out;
    out << "0x" << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

rg::CompileResult invalid_cycle_graph() {
    rg::Graph graph;
    graph.name = "invalid_cycle";
    graph.add_texture("ping", rg::Format::RGBA8Unorm, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_texture("pong", rg::Format::RGBA8Unorm, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"pass_a", rg::PassKind::Compute, "a",
                    {{"ping", rg::AccessMode::Read, rg::AccessStage::Compute}},
                    {{"pong", rg::AccessMode::Write, rg::AccessStage::Compute}},
                    {}});
    graph.add_pass({"pass_b", rg::PassKind::Compute, "b",
                    {{"pong", rg::AccessMode::Read, rg::AccessStage::Compute}},
                    {{"ping", rg::AccessMode::Write, rg::AccessStage::Compute}},
                    {}});
    return rg::compile(graph);
}

rg::CompileResult invalid_missing_prerequisite_graph() {
    rg::Graph graph;
    graph.name = "invalid_missing_prerequisite";
    graph.add_texture("shadow_map", rg::Format::R32Float, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_texture("lit_scene", rg::Format::RGBA16Float, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"shadow_receiver", rg::PassKind::Compute,
                    "shadow_lighting.comp.spv",
                    {{"shadow_map", rg::AccessMode::Read,
                      rg::AccessStage::Compute}},
                    {{"lit_scene", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});
    return rg::compile(graph);
}

rg::CompileResult invalid_write_conflict_graph() {
    rg::Graph graph;
    graph.name = "invalid_write_conflict";
    graph.add_texture("target", rg::Format::RGBA8Unorm, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"first_writer", rg::PassKind::Compute, "a", {},
                    {{"target", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});
    graph.add_pass({"second_writer", rg::PassKind::Compute, "b", {},
                    {{"target", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});
    return rg::compile(graph);
}

bool run_invalid_demos(const Options& options) {
    const auto cycle = invalid_cycle_graph();
    const auto missing = invalid_missing_prerequisite_graph();
    const auto conflict = invalid_write_conflict_graph();
    write_reports(cycle, options.report_dir, "invalid_cycle");
    write_reports(missing, options.report_dir, "invalid_missing_prerequisite");
    write_reports(conflict, options.report_dir, "invalid_write_conflict");

    const auto* cycle_error = cycle.errors().empty() ? nullptr : cycle.errors()[0];
    const auto* missing_error =
        missing.errors().empty() ? nullptr : missing.errors()[0];
    const auto* conflict_error =
        conflict.errors().empty() ? nullptr : conflict.errors()[0];
    if (cycle_error == nullptr || missing_error == nullptr ||
        conflict_error == nullptr) {
        std::cerr << "invalid graph demos unexpectedly compiled\n";
        return false;
    }
    std::cout << "[invalid] cycle -> pass " << cycle_error->pass << ": "
              << cycle_error->message << "\n";
    std::cout << "[invalid] missing prerequisite -> pass "
              << missing_error->pass << ": " << missing_error->message << "\n";
    std::cout << "[invalid] write conflict -> pass " << conflict_error->pass
              << ": " << conflict_error->message << "\n";
    return true;
}

std::vector<rg::RenderPath> selected_paths(const std::string& selected) {
    if (selected == "all") {
        return {rg::RenderPath::Shadow, rg::RenderPath::PostProcess,
                rg::RenderPath::Screenshot};
    }
    if (selected == "shadow") {
        return {rg::RenderPath::Shadow};
    }
    if (selected == "postprocess" || selected == "post") {
        return {rg::RenderPath::PostProcess};
    }
    if (selected == "screenshot") {
        return {rg::RenderPath::Screenshot};
    }
    return {};
}

}  // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parse_options(argc, argv, options)) {
        print_usage();
        return EXIT_FAILURE;
    }
    const auto paths = selected_paths(options.path);
    if (paths.empty()) {
        std::cerr << "unknown path: " << options.path << "\n";
        return EXIT_FAILURE;
    }

    std::filesystem::create_directories(options.report_dir);
    std::filesystem::create_directories(options.artifact_dir);
    if (!run_invalid_demos(options)) {
        return EXIT_FAILURE;
    }

    bool failed = false;
    for (rg::RenderPath path : paths) {
        const std::string name = rg::path_name(path);
        const auto graph = rg::build_path(path, options.width, options.height);
        auto compiled = rg::compile(graph);
        if (!compiled.ok()) {
            std::cerr << "[" << name << "] compile failed\n";
            write_reports(compiled, options.report_dir, name);
            failed = true;
            continue;
        }

        std::cout << "[" << name << "] " << rg::path_description(path) << "\n";
        std::cout << "[" << name << "] passes:";
        for (std::size_t index : compiled.schedule) {
            std::cout << ' ' << graph.passes[index].name;
        }
        std::cout << "\n[" << name << "] estimated peak: "
                  << compiled.allocation.peak_bytes << " bytes\n";

        if (options.vulkan) {
            rg::VulkanRunOptions run_options;
            run_options.final_image = rg::final_image_resource(path);
            run_options.ppm_path =
                options.artifact_dir + "/" + name + ".ppm";
            auto run = rg::run_vulkan(graph, compiled, run_options);
            if (!run.success) {
                std::cerr << "[" << name << "] Vulkan failure: " << run.error
                          << "\n";
                write_reports(compiled, options.report_dir, name);
                failed = true;
                continue;
            }
            compiled = std::move(run.compiled);
            std::cout << "[" << name << "] Vulkan: " << run.backend << "\n";
            std::cout << "[" << name << "] actual peak: "
                      << compiled.allocation.peak_bytes
                      << " bytes, reused: "
                      << compiled.allocation.reused_bytes << " bytes\n";
            std::cout << "[" << name << "] screenshot: " << run_options.ppm_path
                      << " " << run.width << "x" << run.height
                      << " checksum=" << checksum(run.rgba8) << "\n";
        }
        write_reports(compiled, options.report_dir, name);
    }
    return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}
