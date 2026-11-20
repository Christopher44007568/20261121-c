import Foundation

/// Tangent-plane camera: world degrees <-> screen pixels.
public struct Camera {
    /// World-space center of the view, degrees.
    public var centerX: Float = 0
    public var centerY: Float = 0
    /// Screen pixels per degree (zoom).
    public var scale: Float = 400

    public init() {}

    public func worldToScreen(x: Float, y: Float,
                              viewportW: Float, viewportH: Float) -> (Float, Float) {
        ((x - centerX) * scale + viewportW * 0.5,
         (centerY - y) * scale + viewportH * 0.5)
    }

    public mutating func panByScreenPixels(dx: Float, dy: Float) {
        centerX += dx / scale
        centerY -= dy / scale
    }

    public mutating func zoom(by factor: Float) {
        scale = max(20, min(20000, scale * factor))
    }

    /// Visible world area in square degrees.
    public func fieldArea(viewportW: Float, viewportH: Float) -> Float {
        (viewportW / scale) * (viewportH / scale)
    }
}

/// Density-budget culling: the catalog is sorted brightest-first, so given a
/// maximum allowed on-screen star density (stars / deg^2) we keep the
/// brightest prefix whose in-field count fits the budget. Dim stars are
/// dropped first, which is the visually safe direction.
public enum DensityCuller {
    public static let maxStarsPerSquareDegree: Float = 40_000

    /// Returns the stars to draw this frame: brightest-first, clipped to the
    /// view and capped so in-field density stays under the budget.
    public static func visibleStars(catalog: [Star], camera: Camera,
                                    viewportW: Float, viewportH: Float,
                                    maxDensity: Float = maxStarsPerSquareDegree) -> [Star] {
        let halfW = viewportW * 0.5 / camera.scale
        let halfH = viewportH * 0.5 / camera.scale
        let budget = Int(maxDensity
                         * camera.fieldArea(viewportW: viewportW, viewportH: viewportH))
        var result: [Star] = []
        result.reserveCapacity(min(budget, catalog.count))
        for star in catalog {
            if result.count >= budget { break }
            if abs(star.x - camera.centerX) <= halfW + Photometry.quadHalfSize / camera.scale,
               abs(star.y - camera.centerY) <= halfH + Photometry.quadHalfSize / camera.scale {
                result.append(star)
            }
        }
        return result
    }
}
