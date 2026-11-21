#ifndef SSS_PROFILE_HLSL
#define SSS_PROFILE_HLSL

#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"

// Three-lobe separated diffusion profile. Each lobe is a spatial Gaussian.
// Radii are standard deviations in world metres, ordered RGB.
// Lobe 0 carries the wide red transport; lobe 2 is the tight surface bleed.
static const float3 SSS_LobeRadiusM[3] =
{
    float3(0.0065, 0.0048, 0.0035),
    float3(0.0024, 0.0015, 0.0010),
    float3(0.00055, 0.0004, 0.00028)
};

static const float3 SSS_LobeWeight[3] =
{
    float3(0.32, 0.15, 0.10),
    float3(0.38, 0.40, 0.35),
    float3(0.30, 0.45, 0.55)
};

// Mean free path per channel drives the Beer-Lambert thickness term.
static const float3 SSS_MeanFreePathM = float3(0.0035, 0.0017, 0.0009);
static const float3 SSS_ScatterTint   = float3(1.0, 0.36, 0.22);

// Separable-kernel calibration 1 / sqrt(1 + 2/3), matching the Jimenez/HDRP
// separated diffusion convention: authored profile radii are mapped to the
// Gaussian standard deviation actually sampled by the separable passes.
static const float SSS_SEPARABLE_KERNEL_SCALE = 0.7869f;

// Effective first-moment radius used by the measurement overlay:
// sum_k w_k * sigma_k per channel (red channel defines the headline 3.157 mm).
float3 SSS_EffectiveRadiusM()
{
    float3 r = float3(0, 0, 0);
    [unroll]
    for (int k = 0; k < 3; ++k)
        r += SSS_LobeWeight[k] * SSS_LobeRadiusM[k] * SSS_SEPARABLE_KERNEL_SCALE;
    return r;
}

// Beer-Lambert transmission through a slab of thicknessM.
float3 SSS_Transmission(float thicknessM)
{
    return exp(-thicknessM / SSS_MeanFreePathM);
}

// Gaussian weight for a pixel offset dPx and a per-lobe pixel standard deviation.
float SSS_GaussianWeight(float dPx, float sigmaPx)
{
    float x = dPx / max(sigmaPx, 1e-4);
    return exp(-0.5 * x * x);
}

#endif
