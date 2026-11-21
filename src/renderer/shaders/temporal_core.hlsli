// Shared temporal-upscaler core, valid in both HLSL (fxc/dxc) and standard C++
// (included through shim_cpp.h). Keep this file to the common HLSL/C++ subset:
// POD vector types only, no texture/SamplerState access, no matrix intrinsics.
#ifndef TEMPORAL_CORE_HLSLI
#define TEMPORAL_CORE_HLSLI

#ifndef OUT_PARAM
#define OUT_PARAM out
#endif
#ifndef CORE_INLINE
#define CORE_INLINE inline
#endif

// ---- Jitter ---------------------------------------------------------------

// Halton low-discrepancy sequence value in [0,1) for sample index >= 1.
CORE_INLINE float Halton(int index, int base)
{
    float f = 1.0f;
    float r = 0.0f;
    int i = index;
    while (i > 0)
    {
        f /= (float)base;
        r += f * (float)(i % base);
        i /= base;
    }
    return r;
}

// Sub-pixel jitter offset in pixels for a render target of width x height.
// Halton returns a normalized offset in [0,1) so the result is in
// [-0.5, 0.5) pixels; width/height are only used to keep the offset inside the
// target if a custom scale is ever applied. frameIndex is 1-based and cycles
// every 8 frames.
CORE_INLINE float2 JitterOffsetPx(int frameIndex, int width, int height)
{
    int idx = (frameIndex - 1) % 8 + 1;
    float jx = Halton(idx, 2) - 0.5f;
    float jy = Halton(idx, 3) - 0.5f;
    (void)width; (void)height;
    return float2(jx, jy);
}

// ---- Color helpers --------------------------------------------------------

CORE_INLINE float Luma(float3 c)
{
    return 0.2126f * c.x + 0.7152f * c.y + 0.0722f * c.z;
}

// ---- Reprojection ---------------------------------------------------------

// Convert a pixel coordinate of the current frame into the pixel coordinate
// of the previous frame. jitterPx is the current frame's sub-pixel jitter,
// velocityPx the motion-vector value at that pixel (prev = current - motion),
// prevJitterPx the previous frame's jitter, which must be removed because the
// history texture was rendered with it baked in.
CORE_INLINE float2 ReprojectPixel(float2 currentPx, float2 jitterPx,
                                  float2 velocityPx, float2 prevJitterPx)
{
    return currentPx - jitterPx - velocityPx + prevJitterPx;
}

// Scale+bias mapping a normalized coordinate in a buffer of oldSize into one
// of newSize, where both buffers cover the same viewport. Because normalized
// UVs over a shared viewport are identical, the bias is zero; the scale is the
// size ratio and is only nonzero when mapping between pixel-spaces that carry
// different units. Half-texel correctness is handled by the sampler's
// pixel-center convention (UV = (pixel + 0.5) / size), not by this offset.
CORE_INLINE void ResizeScaleBias(int oldW, int oldH, int newW, int newH,
                                 OUT_PARAM float2 scale, OUT_PARAM float2 bias)
{
    scale = float2((float)newW / (float)oldW, (float)newH / (float)oldH);
    bias = float2(0.0f, 0.0f);
}

// Apply ResizeScaleBias to a normalized UV. Used to keep history valid across
// dynamic-resolution changes and window (viewport) resizes.
CORE_INLINE float2 RemapUv(float2 uv, float2 scale, float2 bias)
{
    return uv * scale + bias;
}

// ---- Neighborhood color bounds (variance clipping) ------------------------

struct Neighborhood
{
    float3 minColor;
    float3 maxColor;
    float3 meanColor;
};

// 3x3 min/max/mean around the current sample (center weighted twice).
CORE_INLINE Neighborhood MakeNeighborhood(float3 c, float3 l, float3 r,
                                          float3 u, float3 d,
                                          float3 ul, float3 ur, float3 dl, float3 dr)
{
    Neighborhood n;
    n.minColor = min(min(min(min(c, l), min(r, u)), min(d, ul)), min(ur, min(dl, dr)));
    n.maxColor = max(max(max(max(c, l), max(r, u)), max(d, ul)), max(ur, max(dl, dr)));
    n.meanColor = (c * 2.0f + l + r + u + d + ul + ur + dl + dr) / 10.0f;
    return n;
}

// Clip history color into an AABB centered on the neighborhood mean. The box
// is shrunk by gamma (variance clip) to reject history that disagrees with the
// local current-frame statistics while keeping stable thin lines stable.
CORE_INLINE float3 ClipToAabb(float3 history, const Neighborhood n, float gamma)
{
    float3 center = n.meanColor;
    float3 mn = center + (n.minColor - center) * gamma;
    float3 mx = center + (n.maxColor - center) * gamma;
    float3 p = history - center;
    float3 dim = max(mx - mn, float3(1e-6f, 1e-6f, 1e-6f));
    float3 q = p / dim;
    float t = max(max(max(q.x, q.y), q.z), 1.0f);
    return center + p / t;
}

// ---- Disocclusion / history confidence ------------------------------------

// Returns 0 when the reprojected sample is unusable (disoccluded or outside
// the old viewport) and 1 when fully trustworthy.
//   uv            : reprojected normalized coordinate in the history buffer
//   velPx, nbrPx  : center velocity and maximum neighbor velocity magnitude (px)
//   depthDelta    : |current linear depth - reprojected history depth|
//   refDepth      : current linear depth; the test is relative (reversed-Z
//                   friendly) so distant geometry is not rejected by absolute
//                   epsilon noise on large depth values
CORE_INLINE float HistoryConfidence(float2 uv, float velPx, float nbrPx,
                                    float depthDelta, float refDepth)
{
    float inside = (uv.x >= 0.0f && uv.x <= 1.0f &&
                    uv.y >= 0.0f && uv.y <= 1.0f) ? 1.0f : 0.0f;
    // Velocity inconsistency: an occlusion boundary sweeps over this pixel
    // only when neighbor motion dwarfs the center motion. Static edges have
    // zero center velocity with nonzero neighbors and must stay valid, so the
    // gate is on absolute neighbor magnitude, not on a ratio to the center.
    float velConsistent = nbrPx <= 4.0f || nbrPx <= velPx * 3.0f + 0.75f
                          ? 1.0f : 0.0f;
    float depthConsistent = depthDelta <= max(0.05f, refDepth * 0.02f)
                            ? 1.0f : 0.0f;
    return inside * velConsistent * depthConsistent;
}

// Per-pixel temporal blend factor. Confidence scales the nominal history
// weight; fast motion and luma disagreement (thin-line reveal) shorten it.
CORE_INLINE float TemporalAlpha(float confidence, float velPx,
                                float currentLuma, float historyLuma,
                                float maxHistoryWeight, float velocityTau)
{
    float motion = 1.0f - exp(-velPx / velocityTau);              // 0..1
    float lumaDiff = abs(currentLuma - historyLuma);
    float reveal = smoothstep(0.05f, 0.35f, lumaDiff);            // thin line reveal
    float historyWeight = maxHistoryWeight * confidence
                        * (1.0f - 0.5f * motion) * (1.0f - reveal);
    return clamp(1.0f - historyWeight, 0.0f, 1.0f); // alpha of the current sample
}

#endif // TEMPORAL_CORE_HLSLI
