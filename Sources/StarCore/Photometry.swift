import Foundation

/// Photometric kernel shared (formula-identical) with the Metal shader and
/// with `tools/photometry_check.py`. Keep all three in sync.
public enum Photometry {
    /// PSF sigma in screen pixels (seeing-limited: constant vs. zoom).
    public static let psfSigma: Float = 0.75
    /// Quad half-size in pixels; 4 sigma truncates < 2e-4 of total flux.
    public static let quadHalfSize: Float = 4.0 * psfSigma

    /// Pogson law: flux ratio between two magnitudes.
    @inline(__always)
    public static func fluxRatio(deltaMag: Float) -> Float {
        pow(10.0, -0.4 * deltaMag)
    }

    /// Magnitude -> linear flux, referenced to magnitude 0 = 1.
    @inline(__always)
    public static func flux(forMagnitude mag: Float) -> Float {
        fluxRatio(deltaMag: mag)
    }

    /// Abramowitz & Stegun 7.1.26 erf approximation, |eps| <= 1.5e-7.
    /// Identical polynomial is used in the fragment shader so CPU and GPU
    /// agree to float precision.
    @inline(__always)
    public static func erfApprox(_ x: Float) -> Float {
        let t = 1.0 / (1.0 + 0.3275911 * abs(x))
        let poly = ((((1.061405429 * t - 1.453152027) * t)
                     + 1.421413741) * t - 0.284496736) * t + 0.254829592
        let y = 1.0 - poly * t * exp(-x * x)
        return x >= 0 ? y : -y
    }

    /// Exact integral of a normalized 1-D Gaussian over [x0, x1].
    @inline(__always)
    public static func gaussianIntegral1D(_ x0: Float, _ x1: Float,
                                          mean: Float, sigma: Float) -> Float {
        let invRoot2 = Float(0.7071067811865476) / sigma
        return 0.5 * (erfApprox((x1 - mean) * invRoot2)
                      - erfApprox((x0 - mean) * invRoot2))
    }

    /// Flux deposited by a point source of total `flux` into the pixel whose
    /// area spans [px-0.5, px+0.5] x [py-0.5, py+0.5] around the source at
    /// (cx, cy). This area-integral (rather than a point sample) is what makes
    /// sub-pixel stars keep constant total flux under camera jitter.
    @inline(__always)
    public static func pixelFlux(cx: Float, cy: Float, px: Float, py: Float,
                                 flux: Float, sigma: Float = psfSigma) -> Float {
        let gx = gaussianIntegral1D(px - 0.5, px + 0.5, mean: cx, sigma: sigma)
        let gy = gaussianIntegral1D(py - 0.5, py + 0.5, mean: cy, sigma: sigma)
        return flux * gx * gy
    }
}
