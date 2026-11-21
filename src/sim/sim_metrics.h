#ifndef SIM_METRICS_H
#define SIM_METRICS_H

#include <cmath>
#include <vector>

#include "sim_buffer.h"
#include "sim_scene.h" // float3 dot/normalize helpers used by the metrics

// Sobel luma gradient magnitude of an RGB buffer.
inline float Sobel(const Buffer2D& b, int x, int y)
{
    auto lum = [&](int ox, int oy) {
        int nx = std::max(0, std::min(x + ox, b.width - 1));
        int ny = std::max(0, std::min(y + oy, b.height - 1));
        return Luma(b.Rgb(nx, ny));
    };
    float gx = -lum(-1, -1) - 2.0f * lum(-1, 0) - lum(-1, 1)
             +  lum( 1, -1) + 2.0f * lum( 1, 0) + lum( 1, 1);
    float gy = -lum(-1, -1) - 2.0f * lum(0, -1) - lum(1, -1)
             +  lum(-1,  1) + 2.0f * lum(0,  1) + lum(1,  1);
    return std::sqrt(gx * gx + gy * gy);
}

struct ErrorMetrics
{
    double rmse = 0.0;        // all-pixel RMSE, tonemapped sRGB
    double edgeRmse = 0.0;    // RMSE weighted toward reference edges
    double thinLineRmse = 0.0;// RMSE inside a dilated edge mask only
    double maxError = 0.0;
};

// Temporal shimmer: mean per-pixel color change between two consecutive output
// frames after the camera contribution is accounted for. Low values mean the
// upscaler suppresses sub-pixel jitter noise instead of flashing it through.
struct FlickerMetrics
{
    double meanDelta = 0.0;
    double edgeDelta = 0.0;    // restricted to reference edge neighborhoods
};

inline FlickerMetrics FrameToFrame(const Buffer2D& prev, const Buffer2D& cur,
                                   const Buffer2D& ref)
{
    assert(prev.width == cur.width && prev.height == cur.height);
    double sum = 0.0, edgeSum = 0.0, edgeWeight = 0.0;
    long count = (long)prev.width * prev.height;
    for (int y = 0; y < prev.height; ++y)
        for (int x = 0; x < prev.width; ++x)
        {
            float3 d = cur.Rgb(x, y) - prev.Rgb(x, y);
            float mag = std::sqrt(dot(d, d));
            sum += mag;
            float edge = Sobel(ref, x, y);
            edgeSum += mag * (1.0f + 4.0f * edge);
            edgeWeight += 1.0f + 4.0f * edge;
        }
    FlickerMetrics m;
    m.meanDelta = sum / count;
    m.edgeDelta = edgeSum / edgeWeight;
    return m;
}

// Compare a candidate image against the fixed high-resolution reference.
inline ErrorMetrics Compare(const Buffer2D& ref, const Buffer2D& cand)
{
    assert(ref.width == cand.width && ref.height == cand.height);
    double sumSq = 0.0, sumEdgeSq = 0.0, edgeWeightSum = 0.0;
    double sumLineSq = 0.0, lineCount = 0.0;
    ErrorMetrics m;
    int count = ref.width * ref.height;

    for (int y = 0; y < ref.height; ++y)
    {
        for (int x = 0; x < ref.width; ++x)
        {
            float3 r = ref.Rgb(x, y), c = cand.Rgb(x, y);
            float3 d = c - r;
            float e2 = dot(d, d);
            sumSq += e2;
            m.maxError = std::max(m.maxError, (double)std::sqrt(e2));

            float edge = Sobel(ref, x, y);
            float w = 1.0 + 4.0f * edge; // edges dominate but still bounded
            sumEdgeSq += e2 * w;
            edgeWeightSum += w;
            if (edge > 0.25f) // dilated implicitly by Sobel's 3x3 footprint
            {
                sumLineSq += e2;
                lineCount += 1.0;
            }
        }
    }
    m.rmse = std::sqrt(sumSq / count);
    m.edgeRmse = std::sqrt(sumEdgeSq / edgeWeightSum);
    m.thinLineRmse = lineCount > 0.0 ? std::sqrt(sumLineSq / lineCount) : 0.0;
    return m;
}

// Analytical GPU time model in milliseconds, calibrated against typical small
// DX11 PBR workloads (G-buffer + lighting scales with shaded pixels; the
// upscaler cost scales with output pixels). The real app replaces this with
// D3D11 disjoint timestamp queries (see GpuTimer in the renderer).
struct GpuCostModel
{
    static constexpr double kGbufferPerMp = 1.35; // ms per megapixel
    static constexpr double kLightingPerMp = 1.85;
    static constexpr double kUpscalePerMp = 0.22;
    static constexpr double kFixedMs = 0.18;       // clears, constant buffers

    static double GBufferMs(int w, int h)
    { return (w * h) * 1e-6 * kGbufferPerMp; }
    static double LightingMs(int w, int h)
    { return (w * h) * 1e-6 * kLightingPerMp; }
    static double UpscaleMs(int w, int h)
    { return (w * h) * 1e-6 * kUpscalePerMp; }

    // TAAU/NoHistory render at the (smaller) internal resolution; Reference
    // renders the full scene at output resolution and needs no upscaler.
    static double FrameMs(int renderW, int renderH, int outW, int outH,
                          bool temporal)
    {
        double ms = kFixedMs + GBufferMs(renderW, renderH)
                  + LightingMs(renderW, renderH);
        if (temporal) ms += UpscaleMs(outW, outH);
        return ms;
    }
};

#endif // SIM_METRICS_H
