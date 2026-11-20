import Metal
import StarCore

/// Headless photometric verification, runnable via `swift run StarPreviewer --verify`.
///
/// Test A — flux conservation under translation: render the calibration
/// cluster offscreen, shift the camera by sub-pixel and whole-pixel offsets,
/// and check the total summed flux stays constant (stars never leave the
/// frame because the cluster occupies only the central region).
///
/// Test B — brightness hierarchy under zoom: measure aperture sums of the
/// three anchor stars at 1x and 4x zoom and check both the ordering and the
/// Pogson flux ratios.
struct Verifier {
    let size = 512
    let renderer: Renderer
    let device: MTLDevice
    let catalog: [Star]

    init() throws {
        guard let device = MTLCreateSystemDefault() else { throw StarPreviewerError.metalUnavailable }
        self.device = device
        renderer = try Renderer(device: device, pixelFormat: .rgba32Float)
        renderer.exposure = 1.0 // raw flux for measurement
        catalog = CalibrationCluster.makeCatalog()
    }

    private func makeTarget() -> MTLTexture {
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba32Float, width: size, height: size, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .shared
        return device.makeTexture(descriptor: d)!
    }

    /// Renders the full (unculled) catalog and returns the framebuffer as
    /// row-major Float luminance.
    private func renderFlux(camera: Camera) -> [Float] {
        let tex = makeTarget()
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = tex
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)
        let cmd = renderer.queue.makeCommandBuffer()!
        let enc = cmd.makeRenderCommandEncoder(descriptor: pass)!
        renderer.encodeStars(catalog, camera: camera,
                             viewport: (Float(size), Float(size)), to: enc)
        enc.endEncoding()
        cmd.commit()
        cmd.waitUntilCompleted()
        var raw = [Float](repeating: 0, count: size * size * 4)
        tex.getBytes(&raw, bytesPerRow: size * 4 * MemoryLayout<Float>.stride,
                     from: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0)
        // Luminance lives in the red channel of each RGBA pixel.
        return stride(from: 0, to: raw.count, by: 4).map { raw[$0] }
    }

    /// Base camera: cluster centered, occupying the central ~50% so small
    /// translations keep every star inside the frame.
    private func baseCamera() -> Camera {
        var c = Camera()
        c.scale = Float(size) / 2.4 // ~2.4 deg across -> cluster radius 0.6 deg fits
        return c
    }

    func run() -> Bool {
        var ok = true
        ok = testFluxConservation() && ok
        ok = testZoomHierarchy() && ok
        print(ok ? "VERIFY: ALL PASS" : "VERIFY: FAILURES")
        return ok
    }

    private func testFluxConservation() -> Bool {
        let base = baseCamera()
        let reference = renderFlux(camera: base).reduce(0, +)
        // Sub-pixel and few-pixel translations (in screen px).
        let offsets: [(Float, Float)] = [(0.13, 0.29), (0.5, 0.5), (0.71, -0.33),
                                         (3.4, -2.1), (-6.0, 4.7)]
        print("Test A: total flux vs. camera translation (reference = \(reference))")
        var maxDev: Float = 0
        for (dx, dy) in offsets {
            var cam = base
            cam.panByScreenPixels(dx: dx, dy: dy)
            let total = renderFlux(camera: cam).reduce(0, +)
            let dev = abs(total - reference) / reference
            maxDev = max(maxDev, dev)
            print(String(format: "  pan (%+6.2f, %+6.2f) px -> flux %.6f  dev %.5f%%",
                         dx, dy, total, dev * 100))
        }
        let pass = maxDev < 0.005
        print("  max deviation \(String(format: "%.5f", maxDev * 100))% "
              + (pass ? "PASS (< 0.5%)" : "FAIL"))
        return pass
    }

    private func testZoomHierarchy() -> Bool {
        let anchors = Array(catalog.filter {
            CalibrationCluster.anchorMagnitudes.contains($0.magnitude)
        }.sorted { $0.magnitude < $1.magnitude })
        guard anchors.count == 3 else { return false }
        print("Test B: anchor hierarchy under zoom (mags "
              + "\(anchors.map { $0.magnitude }))")
        var ok = true
        for zoom in [1.0, 4.0] as [Float] {
            var sums: [Float] = []
            for a in anchors {
                // Center on the anchor so it stays framed at any zoom.
                var cam = baseCamera()
                cam.scale *= zoom
                cam.centerX = a.x
                cam.centerY = a.y
                let img = renderFlux(camera: cam)
                sums.append(apertureSum(img, cx: Float(size) / 2,
                                        cy: Float(size) / 2, radius: 8))
            }
            let r21 = sums[1] / sums[0]
            let r31 = sums[2] / sums[0]
            let e21 = Photometry.fluxRatio(deltaMag: anchors[1].magnitude - anchors[0].magnitude)
            let e31 = Photometry.fluxRatio(deltaMag: anchors[2].magnitude - anchors[0].magnitude)
            let ordered = sums[0] > sums[1] && sums[1] > sums[2]
            let close = abs(r21 - e21) / e21 < 0.02 && abs(r31 - e31) / e31 < 0.02
            print(String(format: "  zoom %.0fx: sums %.4f / %.4f / %.4f  ratios %.4f, %.4f (expect %.4f, %.4f) %@",
                         zoom, sums[0], sums[1], sums[2], r21, r31, e21, e31,
                         ordered && close ? "PASS" : "FAIL"))
            ok = ok && ordered && close
        }
        return ok
    }

    private func apertureSum(_ img: [Float], cx: Float, cy: Float, radius: Int) -> Float {
        var sum: Float = 0
        let x0 = max(0, Int(cx) - radius), x1 = min(size - 1, Int(cx) + radius)
        let y0 = max(0, Int(cy) - radius), y1 = min(size - 1, Int(cy) + radius)
        for y in y0...y1 {
            for x in x0...x1 {
                sum += img[y * size + x]
            }
        }
        return sum
    }
}
