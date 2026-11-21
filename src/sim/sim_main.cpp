#include <cstdio>
#include <fstream>
#include <string>

#include "sim_metrics.h"
#include "sim_upscale.h"

namespace
{
constexpr int kFrames = 60;
constexpr int kOutW = 960;
constexpr int kOutH = 540;

// Scripted dynamic-resolution fraction and a one-frame window (viewport)
// resize. The same schedule is applied to every mode for a fair comparison.
float ResolutionScale(int frame)
{
    if (frame < 12) return 0.67f;
    if (frame < 24) return 0.75f;
    if (frame < 36) return 0.58f; // GPU load spike -> drop internal resolution
    if (frame < 48) return 0.85f;
    return 0.75f;
}

bool WindowResizeFrame(int frame) { return frame == 30; }

struct FrameRecord
{
    int frame;
    int renderW, renderH;
    double rmseNoHistory, edgeNoHistory, lineNoHistory;
    double rmseTaa, edgeTaa, lineTaa;
    double msReference, msNoHistory, msTaa;
};

void DumpPpmFrame(const std::string& dir, int frame,
                  const Buffer2D& ref, const Buffer2D& noHist,
                  const Buffer2D& taa)
{
    char tag[32];
    std::snprintf(tag, sizeof(tag), "f%02d", frame);
    WritePpm(dir + "/ref_" + tag + ".ppm", ref);
    WritePpm(dir + "/nohist_" + tag + ".ppm", noHist);
    WritePpm(dir + "/taau_" + tag + ".ppm", taa);
}
} // namespace

int main(int argc, char** argv)
{
    std::string outDir = argc > 1 ? argv[1] : "results";

    Scene sceneRef, sceneNoHist, sceneTaa;
    Camera prevCamRef = CameraAtFrame(0), prevCamNo = CameraAtFrame(0),
           prevCamTaa = CameraAtFrame(0);
    History histTaa;
    TaaSettings settings;

    std::ofstream csv(outDir + "/metrics.csv");
    csv << "frame,render_w,render_h,"
           "rmse_nohist,edge_nohist,line_nohist,"
           "rmse_taau,edge_taau,line_taau,"
           "flicker_nohist,flicker_taau,"
           "gpu_ms_ref,gpu_ms_nohist,gpu_ms_taau\n";

    double sumEdgeNo = 0.0, sumEdgeTaa = 0.0;
    double sumMsRef = 0.0, sumMsNo = 0.0, sumMsTaa = 0.0;
    double sumFlickNo = 0.0, sumFlickTaa = 0.0;
    Buffer2D prevNoHist, prevTaa;

    for (int frame = 0; frame < kFrames; ++frame)
    {
        Camera cam = CameraAtFrame(frame);
        float scale = ResolutionScale(frame);
        int renderW = (int)(kOutW * scale + 0.5f);
        int renderH = (int)(kOutH * scale + 0.5f);
        bool windowChanged = WindowResizeFrame(frame);

        // One jitter sample per frame, shared by both upscaled modes so the
        // no-history and TAAU paths see identical source pixels. The error
        // metric instead uses the stable (unjittered) full-resolution truth.
        float2 jitterLo = JitterOffsetPx(frame + 1, renderW, renderH);

        GBuffer gNo, gTaa;
        // Stable, unjittered full-resolution truth: what a converged temporal
        // accumulator should approach. Comparing against a per-frame jittered
        // reference would penalize TAAU exactly for removing the jitter noise.
        GBuffer gTruth;
        RenderFrame(sceneRef, cam, prevCamRef, kOutW, kOutH,
                    float2(0.0f), gTruth);
        Buffer2D truth = ReferenceToOutput(gTruth, kOutW, kOutH);
        RenderFrame(sceneNoHist, cam, prevCamNo, renderW, renderH,
                    jitterLo, gNo);
        RenderFrame(sceneTaa, cam, prevCamTaa, renderW, renderH,
                    jitterLo, gTaa);

        Buffer2D noHist = UpscaleNoHistory(gNo, kOutW, kOutH);
        Buffer2D taa = UpscaleTaa(gTaa, kOutW, kOutH, jitterLo,
                                  histTaa, settings, windowChanged);

        ErrorMetrics eNo = Compare(truth, noHist);
        ErrorMetrics eTaa = Compare(truth, taa);
        FlickerMetrics fNo = prevNoHist.width > 0
            ? FrameToFrame(prevNoHist, noHist, truth) : FlickerMetrics{};
        FlickerMetrics fTaa = prevTaa.width > 0
            ? FrameToFrame(prevTaa, taa, truth) : FlickerMetrics{};
        double msRef = GpuCostModel::FrameMs(kOutW, kOutH, kOutW, kOutH, false);
        double msNo = GpuCostModel::FrameMs(renderW, renderH, kOutW, kOutH, true);
        double msTaa = msNo;

        csv << frame << "," << renderW << "," << renderH << ","
            << eNo.rmse << "," << eNo.edgeRmse << "," << eNo.thinLineRmse << ","
            << eTaa.rmse << "," << eTaa.edgeRmse << "," << eTaa.thinLineRmse
            << "," << fNo.edgeDelta << "," << fTaa.edgeDelta
            << "," << msRef << "," << msNo << "," << msTaa << "\n";

        sumEdgeNo += eNo.edgeRmse; sumEdgeTaa += eTaa.edgeRmse;
        sumMsRef += msRef; sumMsNo += msNo; sumMsTaa += msTaa;
        if (frame > 0)
        {
            sumFlickNo += fNo.edgeDelta;
            sumFlickTaa += fTaa.edgeDelta;
        }
        prevNoHist = noHist;
        prevTaa = taa;

        if (frame == 19 || frame == 20 || frame == 29 || frame == 30 ||
            frame == 40 || frame == 41 || frame == 55)
            DumpPpmFrame(outDir, frame, truth, noHist, taa);

        prevCamRef = prevCamNo = prevCamTaa = cam;
        sceneRef.Advance(); sceneNoHist.Advance(); sceneTaa.Advance();
        if (windowChanged)
            std::printf("frame %d: window/viewport resize event handled\n", frame);
    }

    std::printf("\nAverages over %d frames (output %dx%d):\n",
                kFrames, kOutW, kOutH);
    std::printf("  edge RMSE   no-history=%.5f   TAAU=%.5f  (reduction %.1f%%)\n",
                sumEdgeNo / kFrames, sumEdgeTaa / kFrames,
                100.0 * (1.0 - sumEdgeTaa / sumEdgeNo));
    std::printf("  GPU ms      reference=%.3f   upscaled=%.3f  (saving %.1f%%)\n",
                sumMsRef / kFrames, sumMsTaa / kFrames,
                100.0 * (1.0 - sumMsTaa / sumMsRef));
    std::printf("  edge flicker no-history=%.5f  TAAU=%.5f  (reduction %.1f%%)\n",
                sumFlickNo / (kFrames - 1), sumFlickTaa / (kFrames - 1),
                100.0 * (1.0 - sumFlickTaa / sumFlickNo));
    std::printf("CSV written to %s/metrics.csv; key frames exported as PPM\n",
                outDir.c_str());
    csv.close();
    return 0;
}
