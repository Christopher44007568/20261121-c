import Foundation

public struct Star {
    /// World position in degrees (tangent-plane, cluster centered at origin).
    public var x: Float
    public var y: Float
    public var magnitude: Float
    public var flux: Float
}

/// Deterministic, asset-free calibration cluster.
///
/// Layout: three isolated "anchor" stars with exact magnitudes (used by the
/// zoom hierarchy check) plus a King-profile globular-like cluster generated
/// from a seeded xorshift, so the field is identical on every run and needs
/// no external catalog files.
public enum CalibrationCluster {
    public static let anchorMagnitudes: [Float] = [8.0, 9.0, 10.5]
    /// Anchors sit well outside the cluster body (radius ~0.35 deg).
    public static let anchorPositions: [(Float, Float)] = [
        (0.80, 0.55), (-0.75, 0.62), (0.10, -0.85),
    ]
    public static let clusterStarCount = 4000
    public static let seed: UInt64 = 0x9E3779B97F4A7C15

    /// Stars sorted brightest-first, so frame culling is a prefix cut.
    public static func makeCatalog() -> [Star] {
        var rng = XorShift64(state: seed)
        var stars: [Star] = []
        stars.reserveCapacity(clusterStarCount + anchorMagnitudes.count)

        for (mag, pos) in zip(anchorMagnitudes, anchorPositions) {
            stars.append(Star(x: pos.0, y: pos.1,
                              magnitude: mag,
                              flux: Photometry.flux(forMagnitude: mag)))
        }

        // King-like profile: r = rc * tan(u), u uniform, gives a dense core
        // with a natural falloff; truncated at 0.6 deg.
        let coreRadius: Float = 0.05
        for _ in 0..<clusterStarCount {
            let u = rng.nextUniform()
            var r = coreRadius * tan(u * 1.48) // atan(0.6/0.05) ~ 1.487
            if r > 0.6 { r = 0.6 }
            let theta = rng.nextUniform() * 2 * Float.pi
            // Luminosity function: uniform in mag over [12, 18] with a
            // bright-end tail down to mag 10.8.
            var mag = 12.0 + 6.0 * rng.nextUniform()
            if rng.nextUniform() < 0.05 { mag = 10.8 + 1.2 * rng.nextUniform() }
            stars.append(Star(x: r * cos(theta), y: r * sin(theta),
                              magnitude: mag,
                              flux: Photometry.flux(forMagnitude: mag)))
        }
        stars.sort { $0.magnitude < $1.magnitude }
        return stars
    }
}

public struct XorShift64 {
    private var state: UInt64
    public init(state: UInt64) { self.state = state == 0 ? 0x123456789ABCDEF : state }
    public mutating func next() -> UInt64 {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return state
    }
    public mutating func nextUniform() -> Float {
        Float(next() >> 40) / Float(1 << 24)
    }
}
