#ifndef SIM_UPSCALE_H
#define SIM_UPSCALE_H

#include "sim_render.h"

// Persistent history with explicit dimensions so that resolution and window
// changes can be handled with coordinate remapping instead of hard clears.
struct History
{
    Buffer2D color; // RGB, tone-mapped, at last frame's render resolution
    Buffer2D depth; // single channel linear view depth
    int width = 0;
    int height = 0;
    float2 jitterPx = float2(0.0f);
    bool valid = false;
};

inline float3 SampleBilinear(const Buffer2D& b, float u, float v)
{
    float px = u * b.width - 0.5f;
    float py = v * b.height - 0.5f;
    int x0 = (int)std::floor(px), y0 = (int)std::floor(py);
    int x1 = x0 + 1, y1 = y0 + 1;
    float fx = px - x0, fy = py - y0;
    int cx0 = std::max(0, std::min(x0, b.width - 1));
    int cy0 = std::max(0, std::min(y0, b.height - 1));
    int cx1 = std::max(0, std::min(x1, b.width - 1));
    int cy1 = std::max(0, std::min(y1, b.height - 1));
    float3 c00 = b.Rgb(cx0, cy0), c10 = b.Rgb(cx1, cy0);
    float3 c01 = b.Rgb(cx0, cy1), c11 = b.Rgb(cx1, cy1);
    float3 top = c00 * (1.0f - fx) + c10 * fx;
    float3 bot = c01 * (1.0f - fx) + c11 * fx;
    return top * (1.0f - fy) + bot * fy;
}

inline float SampleBilinear1(const Buffer2D& b, float u, float v)
{
    float px = u * b.width - 0.5f;
    float py = v * b.height - 0.5f;
    int x0 = (int)std::floor(px), y0 = (int)std::floor(py);
    int x1 = x0 + 1, y1 = y0 + 1;
    float fx = px - x0, fy = py - y0;
    int cx0 = std::max(0, std::min(x0, b.width - 1));
    int cy0 = std::max(0, std::min(y0, b.height - 1));
    int cx1 = std::max(0, std::min(x1, b.width - 1));
    int cy1 = std::max(0, std::min(y1, b.height - 1));
    float c00 = b.At(cx0, cy0)[0], c10 = b.At(cx1, cy0)[0];
    float c01 = b.At(cx0, cy1)[0], c11 = b.At(cx1, cy1)[0];
    return (c00 * (1.0f - fx) + c10 * fx) * (1.0f - fy)
         + (c01 * (1.0f - fx) + c11 * fx) * fy;
}

inline bool InsideUv(float2 uv)
{
    return uv.x >= 0.0f && uv.x <= 1.0f && uv.y >= 0.0f && uv.y <= 1.0f;
}

enum class UpscaleMode { Reference, NoHistory, Taau };

struct TaaSettings
{
    float maxHistoryWeight = 0.94f;
    float velocityTau = 8.0f;      // px; motion above this fades history fast
    float clipGamma = 0.90f;       // AABB shrink factor
    float depthRange = 1000.0f;
    bool useHistory = true;        // false reproduces the NoHistory path
};

// Reference path: the scene is rendered at the output resolution directly.
inline Buffer2D ReferenceToOutput(const GBuffer& g, int outW, int outH)
{
    Buffer2D out(outW, outH, 3);
    for (int y = 0; y < outH; ++y)
        for (int x = 0; x < outW; ++x)
        {
            float u = (x + 0.5f) / outW, v = (y + 0.5f) / outH;
            float3 c = ToneMap(SampleBilinear(g.color, u, v));
            float* o = out.At(x, y);
            o[0] = c.x; o[1] = c.y; o[2] = c.z;
        }
    return out;
}

// No-history path: plain bilinear spatial upscale, current frame only.
inline Buffer2D UpscaleNoHistory(const GBuffer& g, int outW, int outH)
{
    Buffer2D out(outW, outH, 3);
    for (int y = 0; y < outH; ++y)
        for (int x = 0; x < outW; ++x)
        {
            float2 uv((x + 0.5f) / outW, (y + 0.5f) / outH);
            // Same viewport: normalized UV is identical; the bilinear sampler
            // handles the lower texel density and its pixel-center convention.
            float2 luv = uv;
            float3 c = ToneMap(SampleBilinear(g.color, luv.x, luv.y));
            float* o = out.At(x, y);
            o[0] = c.x; o[1] = c.y; o[2] = c.z;
        }
    return out;
}

// Full temporal upscaler. All math beyond texture sampling lives in the shared
// temporal_core.hlsli, identical to the DX11 compute shader.
inline Buffer2D UpscaleTaa(const GBuffer& g, int outW, int outH,
                           float2 curJitterPx, History& hist,
                           const TaaSettings& s, bool windowChanged)
{
    Buffer2D out(outW, outH, 3);
    int lw = g.color.width, lh = g.color.height;

    // History buffer -> current low-res viewport mapping (dynamic-res change
    // and window resize both go through this half-texel-correct remap).
    float2 histScale(1.0f), histBias(0.0f);
    if (hist.valid)
        ResizeScaleBias(hist.width, hist.height, lw, lh, histScale, histBias);
    // Jitter is stored in old-buffer pixels; rescale into current-buffer pixels.
    float2 prevJitter = hist.valid
        ? hist.jitterPx * float2((float)lw / (float)hist.width,
                                 (float)lh / (float)hist.height)
        : float2(0.0f);
    // Window resizes keep the same scene but change framing slightly: keep the
    // history rather than discarding it, down-weight it for one frame so the
    // newly revealed borders converge quickly.
    float windowConfidence = windowChanged ? 0.25f : 1.0f;

    Buffer2D newColor(lw, lh, 3);
    Buffer2D newDepth(lw, lh, 1);

    for (int y = 0; y < lh; ++y)
    {
        for (int x = 0; x < lw; ++x)
        {
            float2 lowUv((x + 0.5f) / lw, (y + 0.5f) / lh);
            float3 curHdr = g.color.Rgb(x, y);
            float3 cur = ToneMap(curHdr);
            float curDepth = g.color.At(x, y)[3];
            const float* mv = g.motion.At(x, y);
            float2 velPx(mv[0], mv[1]);
            float velMag = std::sqrt(dot(velPx, velPx));

            // Largest neighbor velocity magnitude (occlusion boundary test).
            float nbrVel = 0.0f;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx)
                {
                    int nx = std::max(0, std::min(x + dx, lw - 1));
                    int ny = std::max(0, std::min(y + dy, lh - 1));
                    const float* n = g.motion.At(nx, ny);
                    nbrVel = std::max(nbrVel,
                        std::sqrt(n[0] * n[0] + n[1] * n[1]));
                }

            float3 finalColor = cur;
            if (s.useHistory && hist.valid)
            {
                // Center-origin pixel convention: pixel p is at coordinate p,
                // its center at p+0.5. Jitter and velocity are applied in this
                // space and the single (p+0.5)/size conversion yields the UV.
                float2 reproPx = ReprojectPixel(float2((float)x, (float)y),
                                                 curJitterPx, velPx, prevJitter);
                float2 reproUv((reproPx.x + 0.5f) / lw,
                               (reproPx.y + 0.5f) / lh);
                reproUv = RemapUv(reproUv, histScale, histBias);

                float confidence = 0.0f;
                float3 history(0.0f);
                if (InsideUv(reproUv))
                {
                    history = SampleBilinear(hist.color, reproUv.x, reproUv.y);
                    float historyDepth =
                        SampleBilinear1(hist.depth, reproUv.x, reproUv.y);
                    float relRefDepth = curDepth >= 999.0f ? 1.0f : curDepth;
                    float depthDelta = curDepth >= 999.0f && historyDepth >= 999.0f
                                       ? 0.0f
                                       : std::fabs(curDepth - historyDepth);
                    confidence = HistoryConfidence(
                        reproUv, velMag, nbrVel, depthDelta, relRefDepth);
                    confidence *= windowConfidence;
                }

                if (confidence > 0.0f)
                {
                    // 3x3 current-frame neighborhood for variance clipping.
                    auto get = [&](int ox, int oy) {
                        int nx = std::max(0, std::min(x + ox, lw - 1));
                        int ny = std::max(0, std::min(y + oy, lh - 1));
                        return ToneMap(g.color.Rgb(nx, ny));
                    };
                    Neighborhood nb = MakeNeighborhood(
                        cur, get(-1, 0), get(1, 0), get(0, -1), get(0, 1),
                        get(-1, -1), get(1, -1), get(-1, 1), get(1, 1));
                    history = ClipToAabb(history, nb, s.clipGamma);
                    float alpha = TemporalAlpha(
                        confidence, velMag, Luma(cur), Luma(history),
                        s.maxHistoryWeight, s.velocityTau);
                    finalColor = cur * alpha + history * (1.0f - alpha);
                }
            }
            float* o = newColor.At(x, y);
            o[0] = finalColor.x; o[1] = finalColor.y; o[2] = finalColor.z;
            newDepth.At(x, y)[0] = curDepth;
        }
    }

    // Spatial upscale of the temporally accumulated low-res buffer.
    for (int y = 0; y < outH; ++y)
        for (int x = 0; x < outW; ++x)
        {
            float2 uv((x + 0.5f) / outW, (y + 0.5f) / outH);
            float3 c = SampleBilinear(newColor, uv.x, uv.y);
            float* o = out.At(x, y);
            o[0] = c.x; o[1] = c.y; o[2] = c.z;
        }

    // Swap history, remembering the new dimensions and jitter.
    hist.color = std::move(newColor);
    hist.depth = std::move(newDepth);
    hist.width = lw;
    hist.height = lh;
    hist.jitterPx = curJitterPx;
    hist.valid = true;
    return out;
}

#endif // SIM_UPSCALE_H
