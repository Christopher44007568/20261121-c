import XCTest
@testable import StarCore

final class PhotometryTests: XCTestCase {
    func testErfApproxAccuracy() {
        // Reference values from a high-precision erf.
        XCTAssertEqual(Photometry.erfApprox(0), 0, accuracy: 1e-6)
        XCTAssertEqual(Photometry.erfApprox(1), 0.8427008, accuracy: 2e-6)
        XCTAssertEqual(Photometry.erfApprox(-2), -0.9953223, accuracy: 2e-6)
    }

    func testTotalFluxConservedUnderSubPixelJitter() {
        // Sum the analytic pixel footprint over a 9x9 neighborhood; total
        // must equal the star flux regardless of sub-pixel position.
        let flux = Photometry.flux(forMagnitude: 8)
        for dx in stride(from: Float(0), through: 1, by: 0.137) {
            var total: Float = 0
            for py in -4...4 {
                for px in -4...4 {
                    total += Photometry.pixelFlux(cx: dx, cy: 0.31,
                                                  px: Float(px), py: Float(py),
                                                  flux: flux)
                }
            }
            XCTAssertEqual(total, flux, accuracy: flux * 1e-4, "dx=\(dx)")
        }
    }

    func testPogsonRatios() {
        XCTAssertEqual(Photometry.fluxRatio(deltaMag: 1.0), 0.398107, accuracy: 1e-5)
        XCTAssertEqual(Photometry.fluxRatio(deltaMag: 2.5), 0.1, accuracy: 1e-6)
    }

    func testCalibrationClusterDeterministicAndSorted() {
        let a = CalibrationCluster.makeCatalog()
        let b = CalibrationCluster.makeCatalog()
        XCTAssertEqual(a.count, CalibrationCluster.clusterStarCount + 3)
        XCTAssertEqual(a.map { $0.magnitude }, b.map { $0.magnitude })
        XCTAssertEqual(a.map { $0.x }, b.map { $0.x })
        for i in 1..<a.count {
            XCTAssertLessThanOrEqual(a[i - 1].magnitude, a[i].magnitude)
        }
        XCTAssertEqual(Array(a.prefix(3).map { $0.magnitude }),
                       CalibrationCluster.anchorMagnitudes)
    }

    func testDensityCullerDropsDimmestFirst() {
        let catalog = CalibrationCluster.makeCatalog()
        var cam = Camera()
        cam.scale = 100 // wide field: everything visible, budget-limited
        let wide = DensityCuller.visibleStars(catalog: catalog, camera: cam,
                                              viewportW: 800, viewportH: 600)
        cam.scale = 2000 // narrow field: small area, small budget
        let narrow = DensityCuller.visibleStars(catalog: catalog, camera: cam,
                                                viewportW: 800, viewportH: 600,
                                                maxDensity: 1000)
        XCTAssertLessThan(narrow.count, wide.count)
        // Budget = 1000 * (800/2000) * (600/2000) = 120 stars.
        XCTAssertEqual(narrow.count, 120)
        // Kept stars are always the brightest available.
        XCTAssertEqual(narrow.map { $0.magnitude }.max() ?? 0,
                       narrow.last?.magnitude ?? 0)
        // Anchors (brightest) survive even the tightest budget.
        XCTAssertTrue(narrow.contains { $0.magnitude == 8.0 })
    }
}
