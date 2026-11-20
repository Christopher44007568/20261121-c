/// Metal shader source, compiled at runtime via `device.makeLibrary(source:)`
/// so the SwiftPM executable needs no Xcode asset catalog plumbing.
///
/// The fragment stage evaluates the SAME erf-approximation polynomial as
/// `Photometry.erfApprox` in StarCore: each pixel accumulates the exact
/// integral of the star's 2-D Gaussian PSF over the pixel footprint, so a
/// star smaller than one pixel deposits constant total flux no matter where
/// it lands between pixel centers (camera-jitter stability).
let shaderSource = #"""
#include <metal_stdlib>
using namespace metal;

struct StarInstance {
    float2 worldPos;
    float  flux;
};

struct Uniforms {
    float2 center;       // world-space view center, degrees
    float2 viewport;     // pixels
    float  scale;        // pixels per degree
    float  sigma;        // PSF sigma, pixels
    float  halfSize;     // quad half-size, pixels
    float  exposure;     // display exposure multiplier
};

struct VSOut {
    float4 position [[position]];
    float2 starPixel;    // star center in pixel coords
    float  flux;
};

vertex VSOut starVertex(uint vid [[vertex_id]],
                        uint iid [[instance_id]],
                        const device StarInstance* stars [[buffer(0)]],
                        constant Uniforms& u [[buffer(1)]]) {
    // Two triangles forming a quad, corners in {-1,+1}.
    float2 corner = float2((vid == 1 || vid == 3 || vid == 4) ? 1.0 : -1.0,
                           (vid == 2 || vid == 4 || vid == 5) ? 1.0 : -1.0);
    StarInstance s = stars[iid];
    float2 px = (s.worldPos - u.center) * u.scale + u.viewport * 0.5;
    px.y = u.viewport.y - px.y; // world +y up, screen +y down
    float2 pos = px + corner * u.halfSize;
    float2 ndc = float2(pos.x / u.viewport.x * 2.0 - 1.0,
                        1.0 - pos.y / u.viewport.y * 2.0);
    VSOut o;
    o.position = float4(ndc, 0.0, 1.0);
    o.starPixel = px;
    o.flux = s.flux;
    return o;
}

// Abramowitz & Stegun 7.1.26 — mirror of Photometry.erfApprox.
static float erfApprox(float x) {
    float t = 1.0 / (1.0 + 0.3275911 * abs(x));
    float poly = ((((1.061405429 * t - 1.453152027) * t)
                   + 1.421413741) * t - 0.284496736) * t + 0.254829592;
    float y = 1.0 - poly * t * exp(-x * x);
    return x >= 0.0 ? y : -y;
}

static float gaussianIntegral1D(float x0, float x1, float mean, float sigma) {
    float invRoot2 = 0.70710678118654752 / sigma;
    return 0.5 * (erfApprox((x1 - mean) * invRoot2)
                  - erfApprox((x0 - mean) * invRoot2));
}

fragment float4 starFragment(VSOut in [[stage_in]],
                             constant Uniforms& u [[buffer(1)]]) {
    // Pixel footprint in star-centered coordinates; position.xy is the
    // pixel center, so the footprint is [p - 0.5, p + 0.5].
    float2 lo = in.position.xy - 0.5 - in.starPixel;
    float gx = gaussianIntegral1D(lo.x, lo.x + 1.0, 0.0, u.sigma);
    float gy = gaussianIntegral1D(lo.y, lo.y + 1.0, 0.0, u.sigma);
    float f = in.flux * gx * gy * u.exposure;
    return float4(f, f, f, 1.0);
}
"""#
