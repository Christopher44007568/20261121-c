#include "font.hpp"
#include "gl_api.hpp"
#include "platform.hpp"
#include "renderer.hpp"
#include "ui.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

using oit::ScenePreset;
using oit::ViewMode;
namespace gl = oit::gl;

struct Options {
    bool headless = false;
    bool benchmark = false;
    bool verify = false;
    int width = 1280;
    int height = 800;
    std::string outputDir = "artifacts/benchmark";
    std::string capturePath;
    ScenePreset scene = ScenePreset::NearOpaque;
    ViewMode view = ViewMode::Wboit;
};

struct BenchmarkOrder {
    std::string name;
    oit::RenderMetrics metrics{};
};

struct BenchmarkScene {
    oit::ScenePreset scene = oit::ScenePreset::NearOpaque;
    oit::SceneInfo info{};
    oit::RenderMetrics finalMetrics{};
    std::vector<BenchmarkOrder> orders;
};

void printUsage() {
    std::cout
        << "Usage: oit_viewer [options]\n"
        << "  --headless              Use EGL offscreen rendering\n"
        << "  --benchmark [DIR]       Run both acceptance scenes and write JSON/PPM\n"
        << "  --verify                Exit non-zero if acceptance checks fail\n"
        << "  --capture PATH.ppm      Save the headless frame, including the panel\n"
        << "  --width N --height N    Render size (default 1280x800)\n"
        << "  --scene near|multi      Initial interactive scene\n"
        << "  --view wboit|ref|error|compare\n"
        << "Interactive keys: P panel, O swap order, 1-4 views, F1/F2 scenes,\n"
        << "                  R refresh reference, drag orbit, wheel zoom, Esc quit.\n";
}

bool parseOptions(int argc, char **argv, Options *options, std::string *error) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--headless") {
            options->headless = true;
        } else if (arg == "--benchmark") {
            options->headless = true;
            options->benchmark = true;
            if (i + 1 < argc && argv[i + 1][0] != '-') options->outputDir = argv[++i];
        } else if (arg == "--verify") {
            options->verify = true;
        } else if (arg == "--capture" && i + 1 < argc) {
            options->capturePath = argv[++i];
        } else if (arg == "--width" && i + 1 < argc) {
            options->width = std::atoi(argv[++i]);
        } else if (arg == "--height" && i + 1 < argc) {
            options->height = std::atoi(argv[++i]);
        } else if (arg == "--scene" && i + 1 < argc) {
            const std::string value = argv[++i];
            options->scene = value == "multi" ? oit::ScenePreset::Multilayer
                                              : oit::ScenePreset::NearOpaque;
        } else if (arg == "--view" && i + 1 < argc) {
            const std::string value = argv[++i];
            if (value == "ref") options->view = oit::ViewMode::Reference;
            else if (value == "error") options->view = oit::ViewMode::Error;
            else if (value == "compare") options->view = oit::ViewMode::Compare;
            else options->view = oit::ViewMode::Wboit;
        } else if (arg == "--help" || arg == "-h") {
            printUsage();
            std::exit(0);
        } else {
            if (error) *error = "Unknown argument: " + arg;
            return false;
        }
    }
    options->width = std::max(320, options->width);
    options->height = std::max(240, options->height);
    return true;
}

std::string formatDouble(double value, int precision = 5) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(precision) << value;
    return stream.str();
}

std::string formatBytes(std::uint64_t bytes) {
    const double megabytes = static_cast<double>(bytes) / (1024.0 * 1024.0);
    return formatDouble(megabytes, 2) + " MB";
}

gl::GLuint createTarget(int width, int height, std::string *error) {
    gl::GLuint texture = 0;
    gl::GenTextures(1, &texture);
    gl::BindTexture(gl::GL_TEXTURE_2D, texture);
    gl::TexImage2D(gl::GL_TEXTURE_2D, 0, gl::GL_RGBA8, width, height, 0, gl::GL_RGBA,
                   gl::GL_UNSIGNED_BYTE, nullptr);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MIN_FILTER, gl::GL_NEAREST);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MAG_FILTER, gl::GL_NEAREST);
    gl::BindTexture(gl::GL_TEXTURE_2D, 0);
    gl::GLuint fbo = 0;
    gl::GenFramebuffers(1, &fbo);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, fbo);
    gl::FramebufferTexture2D(gl::GL_FRAMEBUFFER, gl::GL_COLOR_ATTACHMENT0,
                             gl::GL_TEXTURE_2D, texture, 0);
    if (gl::CheckFramebufferStatus(gl::GL_FRAMEBUFFER) != gl::GL_FRAMEBUFFER_COMPLETE) {
        if (error) *error = "Could not create the benchmark framebuffer";
        gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);
        return 0;
    }
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);
    return fbo;
}

bool savePpm(const std::string &path, int width, int height, gl::GLuint framebuffer) {
    std::vector<unsigned char> pixels(static_cast<std::size_t>(width) *
                                      static_cast<std::size_t>(height) * 4);
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, framebuffer);
    gl::ReadBuffer(gl::GL_COLOR_ATTACHMENT0);
    gl::PixelStorei(gl::GL_PACK_ALIGNMENT, 1);
    gl::ReadPixels(0, 0, width, height, gl::GL_RGBA, gl::GL_UNSIGNED_BYTE, pixels.data());
    gl::BindFramebuffer(gl::GL_FRAMEBUFFER, 0);

    std::ofstream file(path, std::ios::binary);
    if (!file) return false;
    file << "P6\n" << width << " " << height << "\n255\n";
    for (int y = height - 1; y >= 0; --y) {
        for (int x = 0; x < width; ++x) {
            const std::size_t offset =
                (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                 static_cast<std::size_t>(x)) * 4;
            file.write(reinterpret_cast<const char *>(&pixels[offset]), 3);
        }
    }
    return static_cast<bool>(file);
}

std::string orderFileName(oit::DrawOrder order) {
    return order == oit::DrawOrder::Forward ? "forward" : "reverse";
}

std::string sceneFileName(oit::ScenePreset scene) {
    return scene == oit::ScenePreset::NearOpaque ? "near_opaque" : "multilayer_low_alpha";
}

void writeMetricsJson(const std::string &path, const oit::Platform &platform,
                      const std::vector<BenchmarkScene> &scenes) {
    std::ofstream file(path);
    file << std::fixed << std::setprecision(9);
    file << "{\n";
    file << "  \"gl_version\": \"" << platform.glVersion() << "\",\n";
    file << "  \"renderer\": \"" << platform.rendererName() << "\",\n";
    file << "  \"reference\": {\"max_width\": 256, \"max_height\": 192, "
            "\"max_fragments_per_pixel\": 96, \"node_bytes\": 16},\n";
    file << "  \"scenes\": [\n";
    for (std::size_t sceneIndex = 0; sceneIndex < scenes.size(); ++sceneIndex) {
        const BenchmarkScene &scene = scenes[sceneIndex];
        const oit::RenderMetrics &last = scene.finalMetrics;
        file << "    {\n";
        file << "      \"name\": \"" << sceneFileName(scene.scene) << "\",\n";
        file << "      \"alpha\": " << scene.info.alpha << ",\n";
        file << "      \"bundles\": " << scene.info.bundles << ",\n";
        file << "      \"tubes\": " << scene.info.totalTubes << ",\n";
        file << "      \"reference_size\": [" << last.refWidth << ", " << last.refHeight
             << "],\n";
        file << "      \"vram_bytes\": {\"main\": " << last.mainVramBytes
             << ", \"low\": " << last.lowVramBytes
             << ", \"reference\": " << last.referenceVramBytes
             << ", \"total\": " << last.totalVramBytes() << "},\n";
        file << "      \"vram_mib\": {\"main\": " << (last.mainVramBytes / 1048576.0)
             << ", \"low\": " << (last.lowVramBytes / 1048576.0)
             << ", \"reference\": " << (last.referenceVramBytes / 1048576.0)
             << ", \"total\": " << (last.totalVramBytes() / 1048576.0) << "},\n";
        file << "      \"orders\": [\n";
        for (std::size_t orderIndex = 0; orderIndex < scene.orders.size(); ++orderIndex) {
            const BenchmarkOrder &order = scene.orders[orderIndex];
            const oit::RenderMetrics &m = order.metrics;
            file << "        {\"draw_order\": \"" << order.name << "\", "
                 << "\"mae\": " << m.mae << ", \"mae_255\": " << m.mae * 255.0
                 << ", \"rmse\": " << m.rmse << ", \"max\": " << m.maxError
                 << ", \"p95\": " << m.p95Error
                 << ", \"changed_percent\": " << m.changedPercent
                 << ", \"order_delta_wboit\": " << m.orderDeltaWboit
                 << ", \"order_delta_reference\": " << m.orderDeltaReference
                 << ", \"reference_ms\": " << m.referenceMs
                 << ", \"fragments\": " << m.totalFragments
                 << ", \"overflow_fragments\": " << m.overflowFragments << "}";
            file << (orderIndex + 1 < scene.orders.size() ? ",\n" : "\n");
        }
        file << "      ]\n";
        file << "    }" << (sceneIndex + 1 < scenes.size() ? ",\n" : "\n");
    }
    file << "  ]\n";
    file << "}\n";
}

int runBenchmark(oit::Platform &platform, oit::Renderer &renderer, const Options &options) {
    std::error_code filesystemError;
    std::filesystem::create_directories(options.outputDir, filesystemError);
    if (filesystemError) {
        std::cerr << "Could not create output directory: " << filesystemError.message() << "\n";
        return 1;
    }

    gl::GLuint target = createTarget(options.width, options.height, nullptr);
    if (!target) {
        std::cerr << "Could not create benchmark render target\n";
        return 1;
    }

    std::vector<BenchmarkScene> results;
    bool accepted = true;
    for (oit::ScenePreset scene : {oit::ScenePreset::NearOpaque, oit::ScenePreset::Multilayer}) {
        renderer.setScene(scene);
        BenchmarkScene result;
        result.scene = scene;
        result.info = renderer.sceneInfo();

        for (oit::DrawOrder order : {oit::DrawOrder::Forward, oit::DrawOrder::Reverse}) {
            renderer.setDrawOrder(order);
            renderer.markReferenceDirty();
            renderer.render(static_cast<int>(target), options.width, options.height,
                            oit::ViewMode::Wboit);
            gl::Finish();

            BenchmarkOrder orderResult;
            orderResult.name = order == oit::DrawOrder::Forward ? "A B C D" : "D C B A";
            orderResult.metrics = renderer.metrics();
            result.orders.push_back(orderResult);
            result.finalMetrics = orderResult.metrics;

            const std::string prefix =
                options.outputDir + "/" + sceneFileName(scene) + "_" + orderFileName(order);
            renderer.render(static_cast<int>(target), options.width, options.height,
                            oit::ViewMode::Compare);
            savePpm(prefix + "_compare.ppm", options.width, options.height, target);
            if (order == oit::DrawOrder::Forward) {
                renderer.render(static_cast<int>(target), options.width, options.height,
                                oit::ViewMode::Reference);
                savePpm(prefix + "_reference.ppm", options.width, options.height, target);
                renderer.render(static_cast<int>(target), options.width, options.height,
                                oit::ViewMode::Error);
                savePpm(prefix + "_error.ppm", options.width, options.height, target);
                renderer.render(static_cast<int>(target), options.width, options.height,
                                oit::ViewMode::Wboit);
                savePpm(prefix + "_wboit.ppm", options.width, options.height, target);
            }

            const oit::RenderMetrics &m = orderResult.metrics;
            std::cout << std::left << std::setw(22) << sceneFileName(scene)
                      << std::setw(10) << orderFileName(order)
                      << " MAE=" << formatDouble(m.mae * 255.0, 4) << "/255"
                      << " p95=" << formatDouble(m.p95Error * 255.0, 4) << "/255"
                      << " orderDelta="
                      << (m.orderDeltaWboit < 0.0 ? std::string("n/a")
                                                  : formatDouble(m.orderDeltaWboit, 7))
                      << " ref=" << formatDouble(m.referenceMs, 2) << "ms"
                      << " vram=" << formatBytes(m.totalVramBytes()) << "\n";
        }

        const oit::RenderMetrics &last = result.orders.back().metrics;
        const bool noOverflow = last.overflowFragments == 0;
        const bool orderInvariant =
            last.orderDeltaWboit >= 0.0 && last.orderDeltaWboit < 5.0e-4 &&
            last.orderDeltaReference >= 0.0 && last.orderDeltaReference < 5.0e-4;
        const bool errorWithinBudget = last.valid && last.mae < 0.05;
        const bool vramWithinBudget = last.totalVramBytes() < 160ull * 1024ull * 1024ull;
        const bool pass = noOverflow && orderInvariant && errorWithinBudget && vramWithinBudget;
        accepted = accepted && pass;
        std::cout << "  acceptance: " << (pass ? "PASS" : "FAIL")
                  << " [overflow=" << last.overflowFragments
                  << " order=" << (orderInvariant ? "stable" : "changed")
                  << " mae=" << (errorWithinBudget ? "budget" : "over-budget")
                  << " vram=" << (vramWithinBudget ? "budget" : "over-budget") << "]\n";
        results.push_back(result);
    }

    const std::string jsonPath = options.outputDir + "/oit_metrics.json";
    writeMetricsJson(jsonPath, platform, results);
    std::cout << "Wrote " << jsonPath << "\n";
    gl::DeleteFramebuffers(1, &target);
    if (options.verify && !accepted) {
        std::cerr << "OIT acceptance checks failed\n";
        return 2;
    }
    return 0;
}

void drawInfoRow(oit::Ui &ui, float x, float &y, float valueX, const std::string &label,
                 const std::string &value, oit::Vec4 valueColor) {
    const float scale = 1.8f;
    ui.text(x, y, scale, {0.58f, 0.68f, 0.75f, 1.0f}, label);
    ui.text(valueX, y, scale, valueColor, value);
    y += 21.0f;
}

std::string formatCount(std::uint64_t value) {
    char buffer[40];
    if (value >= 1000000ull) {
        std::snprintf(buffer, sizeof(buffer), "%.2fM", static_cast<double>(value) / 1.0e6);
    } else if (value >= 1000ull) {
        std::snprintf(buffer, sizeof(buffer), "%.1fK", static_cast<double>(value) / 1.0e3);
    } else {
        std::snprintf(buffer, sizeof(buffer), "%llu",
                      static_cast<unsigned long long>(value));
    }
    return buffer;
}

float drawPanel(oit::Ui &ui, oit::Renderer &renderer, oit::ViewMode &view, int height) {
    const float x = 18.0f;
    const float y = 18.0f;
    const float panelWidth = 512.0f;
    const float panelHeight = std::min(static_cast<float>(height) - 36.0f, 700.0f);
    ui.rect(x, y, panelWidth, panelHeight, {0.025f, 0.040f, 0.055f, 0.94f});
    ui.rect(x, y, 4.0f, panelHeight, {0.10f, 0.72f, 0.80f, 0.95f});
    ui.text(x + 16.0f, y + 12.0f, 2.5f, {0.88f, 0.97f, 1.0f, 1.0f},
            "WEIGHTED BLENDED OIT");
    ui.text(x + 16.0f, y + 43.0f, 1.55f, {0.42f, 0.71f, 0.78f, 1.0f},
            "INTERSECTING TUBE BUNDLES / PER-PIXEL REFERENCE");

    const float innerX = x + 14.0f;
    const float sceneButtonWidth = 236.0f;
    if (ui.button(innerX, y + 68.0f, sceneButtonWidth, 31.0f, "F1  NEAR OPAQUE",
                  renderer.scene() == oit::ScenePreset::NearOpaque)) {
        renderer.setScene(oit::ScenePreset::NearOpaque);
    }
    if (ui.button(innerX + sceneButtonWidth + 12.0f, y + 68.0f, sceneButtonWidth, 31.0f,
                  "F2  MULTILAYER", renderer.scene() == oit::ScenePreset::Multilayer)) {
        renderer.setScene(oit::ScenePreset::Multilayer);
    }

    ui.text(innerX, y + 113.0f, 2.0f, {0.78f, 0.86f, 0.91f, 1.0f}, "DRAW ORDER");
    if (ui.button(innerX, y + 134.0f, panelWidth - 28.0f, 31.0f,
                  std::string("SWAP ORDER: ") + oit::orderName(renderer.drawOrder()),
                  renderer.drawOrder() == oit::DrawOrder::Reverse)) {
        renderer.toggleDrawOrder();
    }

    ui.text(innerX, y + 177.0f, 2.0f, {0.78f, 0.86f, 0.91f, 1.0f}, "VIEW");
    const float viewGap = 6.0f;
    const float viewWidth = (panelWidth - 28.0f - viewGap * 3.0f) / 4.0f;
    const char *viewLabels[] = {"WBOIT", "REF", "ERROR", "3-UP"};
    for (int i = 0; i < 4; ++i) {
        if (ui.button(innerX + static_cast<float>(i) * (viewWidth + viewGap), y + 198.0f,
                      viewWidth, 31.0f, viewLabels[i],
                      static_cast<int>(view) == i)) {
            view = static_cast<oit::ViewMode>(i);
        }
    }
    ui.line(innerX, y + 242.0f, panelWidth - 28.0f, {0.20f, 0.38f, 0.45f, 0.8f});

    const oit::RenderMetrics &m = renderer.metrics();
    const oit::SceneInfo &info = renderer.sceneInfo();
    float rowY = y + 252.0f;
    const float valueX = x + 218.0f;
    const oit::Vec4 valueColor{0.90f, 0.95f, 0.97f, 1.0f};
    drawInfoRow(ui, innerX, rowY, valueX, "SCENE", oit::sceneName(renderer.scene()), valueColor);
    drawInfoRow(ui, innerX, rowY, valueX, "ALPHA / B / TUBES",
                formatDouble(info.alpha, 2) + " / " + std::to_string(info.bundles) + " / " +
                    std::to_string(info.totalTubes),
                valueColor);
    ui.text(innerX, rowY, 1.65f, {0.52f, 0.66f, 0.73f, 1.0f},
            "CAM " + renderer.cameraLabel());
    rowY += 21.0f;

    if (m.valid) {
        drawInfoRow(ui, innerX, rowY, valueX, "REFERENCE",
                    std::to_string(m.refWidth) + " X " + std::to_string(m.refHeight) +
                        " (" + formatDouble(renderer.referenceScale() * 100.0f, 1) + "%)",
                    valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "FRAGMENTS", formatCount(m.totalFragments),
                    valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "REF PATH",
                    formatDouble(m.referenceMs, 2) + " MS",
                    m.referenceMs > 20.0 ? oit::Vec4{1.0f, 0.63f, 0.25f, 1.0f} : valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "MAE",
                    formatDouble(m.mae, 5) + "  (" + formatDouble(m.mae * 255.0, 3) +
                        "/255)",
                    {0.58f, 0.95f, 0.72f, 1.0f});
        drawInfoRow(ui, innerX, rowY, valueX, "RMSE", formatDouble(m.rmse, 5), valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "P95 / MAX",
                    formatDouble(m.p95Error * 255.0, 3) + " / " +
                        formatDouble(m.maxError * 255.0, 3) + " /255",
                    valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "CHANGED >1/255",
                    formatDouble(m.changedPercent, 2) + " %", valueColor);
        const std::string orderW =
            m.orderDeltaWboit < 0.0 ? "SWAP TO MEASURE" : formatDouble(m.orderDeltaWboit, 7);
        const std::string orderR =
            m.orderDeltaReference < 0.0 ? "SWAP TO MEASURE"
                                        : formatDouble(m.orderDeltaReference, 7);
        drawInfoRow(ui, innerX, rowY, valueX, "ORDER DELTA W", orderW,
                    {0.58f, 0.95f, 0.72f, 1.0f});
        drawInfoRow(ui, innerX, rowY, valueX, "ORDER DELTA R", orderR,
                    {0.58f, 0.95f, 0.72f, 1.0f});
        drawInfoRow(ui, innerX, rowY, valueX, "VRAM MAIN", formatBytes(m.mainVramBytes),
                    valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "VRAM REF", formatBytes(m.referenceVramBytes),
                    valueColor);
        drawInfoRow(ui, innerX, rowY, valueX, "VRAM TOTAL", formatBytes(m.totalVramBytes()),
                    {0.75f, 0.88f, 1.0f, 1.0f});
        drawInfoRow(ui, innerX, rowY, valueX, "CAP/OVERFLOW",
                    "96 / " + formatCount(m.overflowFragments),
                    m.overflowFragments == 0 ? valueColor
                                             : oit::Vec4{1.0f, 0.38f, 0.28f, 1.0f});
    } else {
        ui.text(innerX, rowY, 2.0f, {1.0f, 0.74f, 0.30f, 1.0f},
                "REFERENCE PENDING");
        rowY += 24.0f;
    }

    const float footerY = y + panelHeight - 45.0f;
    if (ui.button(innerX, footerY, panelWidth - 28.0f, 31.0f, "R  REFRESH REFERENCE",
                  renderer.referenceDirty())) {
        renderer.markReferenceDirty();
    }
    ui.text(innerX, footerY - 19.0f, 1.5f,
            renderer.referenceDirty() ? oit::Vec4{1.0f, 0.68f, 0.30f, 1.0f}
                                      : oit::Vec4{0.47f, 0.65f, 0.70f, 1.0f},
            renderer.referenceDirty() ? "REFERENCE DIRTY: R TO REFRESH"
                                      : "REFERENCE CACHED / ORDER-INDEPENDENT PATH");
    return panelHeight;
}

int runInteractive(oit::Platform &platform, oit::Renderer &renderer,
                   const Options &options) {
    oit::Font font;
    oit::Ui ui;
    std::string error;
    if (!ui.create(&font, &error)) {
        std::cerr << error << "\n";
        return 1;
    }

    bool panelOpen = true;
    bool running = true;
    oit::ViewMode view = options.view;
    renderer.setScene(options.scene);
    float lastPanelHeight = 700.0f;

    while (running && !platform.shouldClose()) {
        platform.pollEvents();
        const oit::InputState &input = platform.input();
        const auto pressed = [&input](oit::Key key) {
            return input.pressed[static_cast<int>(key)];
        };
        if (pressed(oit::Key::Escape)) running = false;
        if (pressed(oit::Key::P)) panelOpen = !panelOpen;
        if (pressed(oit::Key::O)) renderer.toggleDrawOrder();
        if (pressed(oit::Key::R)) renderer.markReferenceDirty();
        if (pressed(oit::Key::F1)) renderer.setScene(oit::ScenePreset::NearOpaque);
        if (pressed(oit::Key::F2)) renderer.setScene(oit::ScenePreset::Multilayer);
        if (pressed(oit::Key::Tab)) {
            renderer.setScene(renderer.scene() == oit::ScenePreset::NearOpaque
                                  ? oit::ScenePreset::Multilayer
                                  : oit::ScenePreset::NearOpaque);
        }
        for (int i = 0; i < 4; ++i) {
            const oit::Key key = static_cast<oit::Key>(static_cast<int>(oit::Key::Digit1) + i);
            if (pressed(key)) view = static_cast<oit::ViewMode>(i);
        }

        const int width = platform.width();
        const int height = platform.height();
        const bool overPanel = panelOpen && input.mouseX >= 18.0f &&
                               input.mouseX <= 530.0f && input.mouseY >= 18.0f &&
                               input.mouseY <= 18.0f + lastPanelHeight;
        if (input.dragging && !overPanel) renderer.orbit(input.dragX, input.dragY);
        if (input.scroll != 0.0f) renderer.zoom(input.scroll);

        renderer.render(0, width, height, view);
        ui.begin(width, height, input);
        if (panelOpen) lastPanelHeight = drawPanel(ui, renderer, view, height);

        const char *hint = "P PANEL   O SWAP   1-4 VIEW   F1/F2 SCENE   R REF";
        const float hintScale = 1.45f;
        const float hintWidth = static_cast<float>(std::strlen(hint)) * 6.0f * hintScale;
        if (!panelOpen || width > static_cast<int>(hintWidth) + 570) {
            const float hintX = static_cast<float>(width) - hintWidth - 17.0f;
            ui.rect(hintX - 8.0f, 14.0f, hintWidth + 14.0f, 22.0f,
                    {0.02f, 0.035f, 0.05f, 0.78f});
            ui.text(hintX, 17.0f, hintScale, {0.62f, 0.76f, 0.82f, 1.0f}, hint);
        }
        if (view == oit::ViewMode::Compare) {
            const char *labels[] = {"WBOIT", "PIXEL SORT REFERENCE", "ERROR"};
            for (int i = 0; i < 3; ++i) {
                const float third = static_cast<float>(width) / 3.0f;
                const float labelX = static_cast<float>(i) * third + 14.0f;
                const float labelWidth = 195.0f;
                ui.rect(labelX - 7.0f, static_cast<float>(height) - 34.0f, labelWidth, 23.0f,
                        {0.02f, 0.035f, 0.05f, 0.78f});
                ui.text(labelX, static_cast<float>(height) - 30.0f, 1.6f,
                        {0.84f, 0.92f, 0.95f, 1.0f}, labels[i]);
            }
        } else if (!panelOpen) {
            ui.rect(14.0f, 14.0f, 224.0f, 30.0f, {0.02f, 0.035f, 0.05f, 0.78f});
            ui.text(22.0f, 20.0f, 2.0f, {0.74f, 0.92f, 0.96f, 1.0f}, oit::viewName(view));
        }
        ui.end();
        platform.swapBuffers();
    }
    (void)renderer;
    return 0;
}

int runHeadlessSingle(oit::Platform &platform, oit::Renderer &renderer,
                      const Options &options) {
    gl::GLuint target = createTarget(options.width, options.height, nullptr);
    if (!target) return 1;
    oit::ViewMode view = options.view;
    renderer.setScene(options.scene);
    renderer.render(static_cast<int>(target), options.width, options.height, view);
    if (!options.capturePath.empty()) {
        oit::Font font;
        oit::Ui ui;
        std::string error;
        if (!ui.create(&font, &error)) {
            std::cerr << error << "\n";
            return 1;
        }
        gl::BindFramebuffer(gl::GL_FRAMEBUFFER, target);
        oit::InputState input{};
        input.mouseX = -1.0f;
        input.mouseY = -1.0f;
        ui.begin(options.width, options.height, input);
        drawPanel(ui, renderer, view, options.height);
        ui.end();
        if (!savePpm(options.capturePath, options.width, options.height, target)) {
            std::cerr << "Could not write capture: " << options.capturePath << "\n";
            return 1;
        }
    }
    gl::Finish();
    const oit::RenderMetrics &m = renderer.metrics();
    std::cout << platform.glVersion() << " / " << platform.rendererName() << "\n"
              << "scene=" << oit::sceneName(renderer.scene()) << " view="
              << oit::viewName(view) << " ref=" << m.refWidth << "x" << m.refHeight
              << " mae=" << formatDouble(m.mae * 255.0, 4) << "/255"
              << " vram=" << formatBytes(m.totalVramBytes())
              << " overflow=" << m.overflowFragments << "\n";
    gl::DeleteFramebuffers(1, &target);
    return 0;
}

}  // namespace

int main(int argc, char **argv) {
    Options options;
    std::string error;
    if (!parseOptions(argc, argv, &options, &error)) {
        std::cerr << error << "\n";
        printUsage();
        return 1;
    }

    oit::Platform platform;
    if (options.headless) {
        if (!platform.createHeadless(options.width, options.height, &error)) {
            std::cerr << "Headless context failed: " << error << "\n";
            return 1;
        }
    } else {
        if (!platform.createWindow(options.width, options.height,
                                   "WBOIT Tube Bundle Lab", &error)) {
            std::cerr << "Window context failed: " << error << "\n";
            return 1;
        }
    }

    oit::Renderer renderer;
    if (!renderer.init(&error)) {
        std::cerr << "Renderer initialization failed: " << error << "\n";
        return 1;
    }
    if (options.benchmark) {
        return runBenchmark(platform, renderer, options);
    }
    if (options.headless) {
        return runHeadlessSingle(platform, renderer, options);
    }
    return runInteractive(platform, renderer, options);
}
