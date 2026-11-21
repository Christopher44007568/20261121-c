#include "vk_engine.hpp"
#include "measure.hpp"
#include <glm/gtc/matrix_transform.hpp>
#include <iostream>
#include <filesystem>

namespace fs = std::filesystem;

namespace {
PushConstants make_push(const Camera& cam, glm::vec3 lightDir,
                        float stripAngle, uint32_t mode) {
    PushConstants pc{};
    pc.viewProj = cam.viewProj;
    pc.lightDir = glm::vec4(lightDir, stripAngle);
    pc.cameraPos = glm::vec4(cam.pos, 0.f);
    // Strong directional anisotropy: tight along the warp (tangent) axis.
    pc.params = glm::vec4(1.f, 0.3f, 0.7f, 0.18f);
    pc.tint = glm::vec4(1.f, 1.f, 1.f, glm::uintBitsToFloat(mode));
    pc.seamX = glm::vec4(0.5f, 0.f, 0.f, 0.f);
    return pc;
}

} // namespace

int main(int argc, char** argv) {
    bool headless = true;
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--window") headless = false;

    fs::path outDir = "output";
    fs::create_directories(outDir);

    std::cout << "Generating procedural fabric textures (" << TEX_SIZE
              << "px)...\n";
    FabricTextures tex = generate_fabric_textures(TEX_SIZE);
    write_png((outDir / "tex_albedo.png").string(), tex.albedo);
    write_png((outDir / "tex_normal.png").string(), tex.normal);
    write_png((outDir / "tex_tangent.png").string(), tex.tangent);

    VulkanEngine engine(headless, RENDER_W, RENDER_H);
    auto verts = build_sphere(96, 128, 0.5f);
    auto indices = build_sphere_indices(96, 128);
    // Rotate the mesh on the CPU so the UV seam meridian faces the camera.
    glm::mat4 rot = glm::rotate(glm::mat4(1.f), float(PI) / 2.f,
                                glm::vec3(0.f, 1.f, 0.f));
    for (auto& vtx : verts) {
        vtx.pos = glm::vec3(rot * glm::vec4(vtx.pos, 1.f));
        vtx.normal = glm::normalize(glm::mat3(rot) * vtx.normal);
        vtx.tangent = glm::vec4(glm::normalize(glm::mat3(rot) *
                                               glm::vec3(vtx.tangent)),
                                vtx.tangent.w);
    }
    engine.load_mesh(verts, indices);
    engine.load_textures(tex);

    fs::path spvDir = fs::current_path() / "shaders";
    engine.load_spirv((spvDir / "fabric.vert.spv").string(),
                      (spvDir / "fabric.frag.spv").string());

    Camera cam = make_camera(RENDER_W, RENDER_H);
    MeasureReport report;

    // Strip light sweeps around the ball; several angles are rendered.
    const float stripAngles[] = {0.f, float(PI) / 4.f, float(PI) / 2.f,
                                 3.f * float(PI) / 4.f};
    // Light close to the camera so the specular lobe lands on the front face.
    glm::vec3 L = glm::normalize(glm::vec3(0.35f, 0.45f, 1.0f));
    for (size_t i = 0; i < 4; ++i) {
        auto pc = make_push(cam, L, stripAngles[i], MODE_FABRIC);
        auto img = engine.render_frame(pc);
        write_png((outDir / ("fabric_strip" + std::to_string(i) + ".png"))
                      .string(),
                  img);
    }

    // Debug views: tangent, normal, mirrored UV.
    const char* debugNames[] = {"debug_tangent", "debug_normal", "debug_uv"};
    for (uint32_t mode = MODE_TANGENT; mode <= MODE_UV; ++mode) {
        auto pc = make_push(cam, L, 0.f, mode);
        write_png((outDir / (std::string(debugNames[mode - 1]) + ".png"))
                      .string(),
                  engine.render_frame(pc));
    }
    {
        auto pc = make_push(cam, L, 0.f, 4u);
        write_png((outDir / "debug_spec_ndf.png").string(),
                  engine.render_frame(pc));
    }

    // Comparison render: corrected vs naive tangent frame at the same light.
    auto pcGood = make_push(cam, L, float(PI) / 2.f, MODE_FABRIC);
    auto imgGood = engine.render_frame(pcGood);
    write_png((outDir / "frame_corrected.png").string(), imgGood);
    auto pcBad = make_push(cam, L, float(PI) / 2.f, MODE_FABRIC | 0x100u);
    auto imgBad = engine.render_frame(pcBad);
    write_png((outDir / "frame_naive.png").string(), imgBad);

    // Measurements on both frames.
    report.corrected = measure_frame(imgGood, cam, 0.5f);
    report.naive = measure_frame(imgBad, cam, 0.5f);

    // Specular-only render gives clean GGX lobe cross-sections.
    auto pcSpec = make_push(cam, L, float(PI) / 2.f, 7u);
    ImageData imgSpec = engine.render_frame(pcSpec);
    write_png((outDir / "debug_spec_only.png").string(), imgSpec);
    MeasurementResult specMeasure = measure_frame(imgSpec, cam, 0.5f);
    report.specOnly = specMeasure;

    // Re-sample cross-section profiles (angle, luminance) for CSV output.
    glm::vec2 ctr = project(cam.viewProj, glm::vec3(0), RENDER_W, RENDER_H);
    float radPx = float(RENDER_H) * 0.5f * 0.82f;
    report.sectionT = sweep_section_public(imgGood, cam, true, ctr, radPx);
    report.sectionB = sweep_section_public(imgGood, cam, false, ctr, radPx);
    write_report((outDir / "measurements.txt").string(), report);

    std::cout << "Done. Outputs in " << fs::absolute(outDir) << "\n";
    return 0;
}
