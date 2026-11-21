#pragma once
#include <cstdint>
#include <d3d11.h>
#include <DirectXMath.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;
namespace dx = DirectX;

struct TaaConfig
{
    float maxHistoryWeight = 0.94f;
    float velocityTau = 8.0f;
    float clipGamma = 0.90f;
    bool useHistory = true;
};

enum class UpscalerMode : uint32_t
{
    Reference = 0,  // full internal resolution, no upscaler
    NoHistory = 1,  // dynamic-res render + bilinear upscale, history disabled
    Taau = 2        // dynamic-res render + jittered temporal upscaler
};

// Dynamic-resolution controller. A GPU-time target drives the scale fraction;
// the fraction only changes on frame boundaries so resource allocation and
// history remapping stay deterministic.
class DynamicResolution
{
public:
    float fraction = 0.75f;
    float minFraction = 0.55f;
    float maxFraction = 1.00f;
    float step = 0.05f;
    float targetMs = 8.0f;

    void Update(float measuredGpuMs)
    {
        if (measuredGpuMs <= 0.0f) return;
        if (measuredGpuMs > targetMs * 1.10f)
            fraction -= step;
        else if (measuredGpuMs < targetMs * 0.80f)
            fraction += step;
        if (fraction < minFraction) fraction = minFraction;
        if (fraction > maxFraction) fraction = maxFraction;
    }

    void GetSize(int outW, int outH, int& renderW, int& renderH) const
    {
        renderW = (int)(outW * fraction + 0.5f);
        renderH = (int)(outH * fraction + 0.5f);
        renderW = (renderW + 1) & ~1;
        renderH = (renderH + 1) & ~1;
    }

private:
};

// Halton jitter, 1-based frame index, result in [-0.5, 0.5) pixels.
inline dx::XMFLOAT2 JitterOffset(int frameIndex)
{
    auto halton = [](int index, int base) {
        float f = 1.0f, r = 0.0f;
        while (index > 0) { f /= (float)base; r += f * (index % base); index /= base; }
        return r;
    };
    int idx = (frameIndex - 1) % 8 + 1;
    return dx::XMFLOAT2(halton(idx, 2) - 0.5f, halton(idx, 3) - 0.5f);
}
