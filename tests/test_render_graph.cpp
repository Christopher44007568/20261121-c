#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include "render_graph/paths.hpp"
#include "render_graph/render_graph.hpp"

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << "\n";
        ++failures;
    }
}

std::vector<std::string> schedule_names(const rg::CompileResult& result) {
    std::vector<std::string> names;
    for (std::size_t pass : result.schedule) {
        names.push_back(result.graph.passes[pass].name);
    }
    return names;
}

const rg::Diagnostic* find_diagnostic(const rg::CompileResult& result,
                                      rg::DiagnosticCode code) {
    for (const auto& diagnostic : result.diagnostics) {
        if (diagnostic.code == code) {
            return &diagnostic;
        }
    }
    return nullptr;
}

void test_real_paths() {
    {
        const auto result =
            rg::compile(rg::build_path(rg::RenderPath::Shadow, 640, 360));
        expect(result.ok(), "shadow path compiles");
        const auto names = schedule_names(result);
        expect(names == std::vector<std::string>{"shadow_caster",
                                                  "shadow_receiver"},
               "shadow path is reordered by producer/consumer edges");
        expect(result.allocation.peak_bytes > 0,
               "shadow path has a peak allocation");
    }
    {
        const auto result =
            rg::compile(rg::build_path(rg::RenderPath::PostProcess, 640, 360));
        expect(result.ok(), "postprocess path compiles");
        const auto names = schedule_names(result);
        expect(names == std::vector<std::string>{"scene_lighting",
                                                  "bloom_extract", "tonemap"},
               "postprocess path is reordered scene -> bloom -> tonemap");
    }
    {
        const auto result =
            rg::compile(rg::build_path(rg::RenderPath::Screenshot, 640, 360));
        expect(result.ok(), "screenshot path compiles");
        const auto names = schedule_names(result);
        expect(names == std::vector<std::string>{"shadow_caster",
                                                  "shadow_receiver",
                                                  "bloom_extract", "tonemap",
                                                  "screenshot_copy"},
               "screenshot path is reordered across all pipeline stages");

        const auto* shadow = result.find_lifetime("shadow_map");
        const auto* frame = result.find_lifetime("ldr_frame");
        expect(shadow && frame, "screenshot lifetimes are present");
        if (shadow && frame) {
            expect(shadow->last_pass < frame->first_pass,
                   "shadow map ends before the final frame begins");
        }
        const auto* shadow_placement = result.allocation.find("shadow_map");
        const auto* frame_placement = result.allocation.find("ldr_frame");
        expect(shadow_placement != nullptr && frame_placement != nullptr,
               "screenshot resources receive placements");
        bool has_alias = false;
        for (const auto& placement : result.allocation.placements) {
            has_alias = has_alias || !placement.aliases.empty();
        }
        expect(has_alias,
               "non-overlapping resources share a backing memory block");
        expect(result.allocation.reused_bytes > 0,
               "screenshot allocation reports actual reuse");
        expect(result.allocation.peak_bytes <
                   result.allocation.transient_bytes,
               "screenshot peak is below the sum of transient sizes");
    }
}

void test_cycle_report() {
    rg::Graph graph;
    graph.name = "invalid_cycle";
    graph.add_texture("x", rg::Format::RGBA8Unorm, 16, 16,
                      rg::ResourceUsage::Storage);
    graph.add_texture("y", rg::Format::RGBA8Unorm, 16, 16,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"pass_a", rg::PassKind::Compute, "a",
                    {{"x", rg::AccessMode::Read, rg::AccessStage::Compute}},
                    {{"y", rg::AccessMode::Write, rg::AccessStage::Compute}},
                    {}});
    graph.add_pass({"pass_b", rg::PassKind::Compute, "b",
                    {{"y", rg::AccessMode::Read, rg::AccessStage::Compute}},
                    {{"x", rg::AccessMode::Write, rg::AccessStage::Compute}},
                    {}});

    const auto result = rg::compile(graph);
    expect(!result.ok(), "cycle graph is rejected");
    const auto* diagnostic = find_diagnostic(result, rg::DiagnosticCode::Cycle);
    expect(diagnostic != nullptr, "cycle diagnostic is emitted");
    if (diagnostic) {
        expect(diagnostic->pass == "pass_a",
               "cycle diagnostic points at the first pass in the cycle");
        expect(diagnostic->message.find("pass_a -> pass_b -> pass_a") !=
                   std::string::npos,
               "cycle diagnostic renders the exact pass path");
    }
}

void test_missing_prerequisite_report() {
    rg::Graph graph;
    graph.name = "invalid_missing_prerequisite";
    graph.add_texture("shadow_map", rg::Format::R32Float, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_texture("lit_scene", rg::Format::RGBA16Float, 64, 64,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"shadow_receiver", rg::PassKind::Compute,
                    "shadow_lighting",
                    {{"shadow_map", rg::AccessMode::Read,
                      rg::AccessStage::Compute}},
                    {{"lit_scene", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});

    const auto result = rg::compile(graph);
    expect(!result.ok(), "uninitialized read graph is rejected");
    const auto* diagnostic =
        find_diagnostic(result, rg::DiagnosticCode::UninitializedRead);
    expect(diagnostic != nullptr, "uninitialized read diagnostic is emitted");
    if (diagnostic) {
        expect(diagnostic->pass == "shadow_receiver",
               "missing prerequisite diagnostic points at the reading pass");
        expect(diagnostic->resource == "shadow_map",
               "missing prerequisite diagnostic points at the resource");
    }
}

void test_write_conflict() {
    rg::Graph graph;
    graph.name = "invalid_write_conflict";
    graph.add_texture("target", rg::Format::RGBA8Unorm, 16, 16,
                      rg::ResourceUsage::Storage);
    graph.add_pass({"first_writer", rg::PassKind::Compute, "a", {},
                    {{"target", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});
    graph.add_pass({"second_writer", rg::PassKind::Compute, "b", {},
                    {{"target", rg::AccessMode::Write,
                      rg::AccessStage::Compute}},
                    {}});
    const auto result = rg::compile(graph);
    const auto* diagnostic =
        find_diagnostic(result, rg::DiagnosticCode::MultipleWriters);
    expect(diagnostic != nullptr,
           "multiple writers produce a read/write conflict diagnostic");
    if (diagnostic) {
        expect(diagnostic->pass == "second_writer",
               "write conflict points at the conflicting pass");
        expect(diagnostic->related_passes ==
                   std::vector<std::string>{"first_writer"},
               "write conflict names the prior writer");
    }
}

void test_readable_outputs() {
    const auto result =
        rg::compile(rg::build_path(rg::RenderPath::Screenshot, 320, 180));
    const auto text = rg::render_text(result);
    expect(text.find("peak allocation") != std::string::npos,
           "text report includes peak allocation");
    expect(text.find("shadow_map") != std::string::npos,
           "text report includes intermediate resources");
    const auto mermaid = rg::render_mermaid(result);
    expect(mermaid.find("flowchart LR") != std::string::npos,
           "mermaid report is a readable graph");
    expect(mermaid.find("shadow_receiver") != std::string::npos,
           "mermaid graph includes pass nodes");
    const auto dot = rg::render_dot(result);
    expect(dot.find("digraph") != std::string::npos,
           "dot report is a readable graph");
}

}  // namespace

int main() {
    test_real_paths();
    test_cycle_report();
    test_missing_prerequisite_report();
    test_write_conflict();
    test_readable_outputs();
    if (failures != 0) {
        std::cerr << failures << " test(s) failed\n";
        return EXIT_FAILURE;
    }
    std::cout << "render graph tests passed\n";
    return EXIT_SUCCESS;
}
