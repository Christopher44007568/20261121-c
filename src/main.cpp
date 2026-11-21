#include "camera.hpp"
#include "csm.hpp"
#include "scene.hpp"
#include "raster.hpp"
#include "render.hpp"
#include "imageio.hpp"
#include "diagnostics.hpp"
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <sys/types.h>

struct Args {
    std::string mode = "all";
    std::string outDir = "artifacts";
    bool lockCamera = false;
    bool tint = false;
    float shadowDistance = 110.0f;
    float sunElevationDeg = 9.0f;
};

static Args parseArgs(int argc, char** argv) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        std::string k = argv[i];
        auto next = [&](const char* dflt) {
            return i + 1 < argc ? argv[++i] : dflt;
        };
        if (k == "--mode") a.mode = next("all");
        else if (k == "--out") a.outDir = next("artifacts");
        else if (k == "--lock-camera") a.lockCamera = true;
        else if (k == "--tint") a.tint = true;
        else if (k == "--shadow-distance")
            a.shadowDistance = std::atof(next("110"));
        else if (k == "--sun-elevation")
            a.sunElevationDeg = std::atof(next("9"));
    }
    return a;
}

static std::vector<Cascade> fitAll(const CameraState& cam,
                                   const CameraParams& cp,
                                   const CSMConfig& cfg,
                                   const Scene& scene,
                                   std::vector<ColorBuffer>& maps) {
    std::vector<float> splits = cascadeSplits(cfg);
    std::vector<Cascade> out;
    maps.clear();
    for (int i = 0; i < kCascadeCount; ++i) {
        out.push_back(fitCascade(i, splits[i], splits[i + 1], cam, cp,
                                 scene.sunDir, cfg));
        maps.emplace_back(cfg.shadowMapSize, cfg.shadowMapSize);
        ShadowRenderOpts sro;
        sro.texelWorld = out.back().texelWorld;
        renderShadowDepth(maps.back(), scene, out.back().lightVP, sro);
    }
    return out;
}

static void runDiagnosticMode(const Args& args, const Scene& scene,
                              const TrajectoryConfig& traj,
                              const CameraParams& cp,
                              const CSMConfig& csmCfg) {
    std::vector<ColorBuffer> maps;
    DiagnosticReport report =
        runDiagnostics(scene, traj, cp, csmCfg, maps);
    writeDiagnosticsJSON(args.outDir + "/diagnostics.json", report);
    std::string text = formatDiagnosticText(report);
    text += "Image            : " + args.outDir + "/cascade_diagnostic.ppm\n";
    text += "JSON             : " + args.outDir + "/diagnostics.json\n";
    FILE* tf = std::fopen((args.outDir + "/diagnostic_run.txt").c_str(), "wb");
    if (tf) { std::fputs(text.c_str(), tf); std::fclose(tf); }
    std::fputs(text.c_str(), stdout);

    // Lockable three-up split: start / middle / end of the trajectory.
    ColorBuffer sheet(960 * 3, 540);
    RenderOptions ro;
    ro.tintCascades = args.tint;
    int frames[3] = {0, traj.frames / 2, traj.frames - 1};
    CameraState locked = trajectoryFrame(traj, traj.frames / 2);
    for (int panel = 0; panel < 3; ++panel) {
        CameraState cam = args.lockCamera
            ? locked
            : trajectoryFrame(traj, frames[panel]);
        std::vector<ColorBuffer> localMaps;
        std::vector<Cascade> cas = fitAll(cam, cp, csmCfg, scene, localMaps);
        ColorBuffer view(960, 540);
        renderView(view, scene, cam, cp, cas, localMaps, ro);
        for (int y = 0; y < 540; ++y)
            for (int x = 0; x < 960; ++x)
                sheet.color[y * sheet.width + panel * 960 + x] =
                    view.color[y * 960 + x];
    }
    writePPM(args.outDir + "/cascade_diagnostic.ppm", sheet);
    writeShadowPGM(args.outDir + "/shadow_0.pgm", maps.front());
}

static void runTrajectoryMode(const Args& args, const Scene& scene,
                              const TrajectoryConfig& traj,
                              const CameraParams& cp,
                              const CSMConfig& csmCfg) {
    ColorBuffer sheet(1920, 360);
    RenderOptions ro;
    const int panelW = 640, panelH = 360;
    int picks[3] = {0, traj.frames / 2, traj.frames - 1};
    for (int panel = 0; panel < 3; ++panel) {
        CameraState cam = trajectoryFrame(traj, picks[panel]);
        std::vector<ColorBuffer> maps;
        std::vector<Cascade> cas = fitAll(cam, cp, csmCfg, scene, maps);
        ColorBuffer view(960, 540);
        renderView(view, scene, cam, cp, cas, maps, ro);
        for (int y = 0; y < panelH; ++y) {
            int srcY = y * 540 / panelH;
            for (int x = 0; x < panelW; ++x) {
                int srcX = x * 960 / panelW;
                sheet.color[y * 1920 + panel * panelW + x] =
                    view.color[srcY * 960 + srcX];
            }
        }
    }
    writePPM(args.outDir + "/trajectory_contact.ppm", sheet);
    std::printf("Wrote %s/trajectory_contact.ppm\n", args.outDir.c_str());
}

int main(int argc, char** argv) {
    Args args = parseArgs(argc, argv);
    mkdir(args.outDir.c_str(), 0755);
    Scene scene = buildScene(args.sunElevationDeg);
    TrajectoryConfig traj;
    CameraParams camParams;
    CSMConfig csmCfg;
    csmCfg.cameraFar = args.shadowDistance;
    camParams.farZ = args.shadowDistance;

    if (args.mode == "diagnostic" || args.mode == "all")
        runDiagnosticMode(args, scene, traj, camParams, csmCfg);
    if (args.mode == "trajectory" || args.mode == "all")
        runTrajectoryMode(args, scene, traj, camParams, csmCfg);
    return 0;
}
