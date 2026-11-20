import Metal
import MetalKit
import StarCore

struct StarInstance {
    var x: Float
    var y: Float
    var flux: Float
    var pad: Float = 0 // matches Metal float2+float stride of 16 bytes
}

struct Uniforms {
    var centerX: Float
    var centerY: Float
    var viewportW: Float
    var viewportH: Float
    var scale: Float
    var sigma: Float
    var halfSize: Float
    var exposure: Float
}

/// Instanced point-sprite renderer with additive blending into a float
/// target. Used both for the on-screen view and for offscreen verification.
final class Renderer {
    let device: MTLDevice
    let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private var instanceBuffer: MTLBuffer
    private var instanceCapacity = 0
    var exposure: Float = 40_000 // display-only; verification uses 1.0

    init(device: MTLDevice, pixelFormat: MTLPixelFormat) throws {
        self.device = device
        guard let q = device.makeCommandQueue() else { throw StarPreviewerError.metalUnavailable }
        queue = q
        let lib = try device.makeLibrary(source: shaderSource, options: nil)
        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = lib.makeFunction(name: "starVertex")
        desc.fragmentFunction = lib.makeFunction(name: "starFragment")
        desc.colorAttachments[0].pixelFormat = pixelFormat
        desc.colorAttachments[0].isBlendingEnabled = true
        desc.colorAttachments[0].sourceRGBBlendFactor = .one
        desc.colorAttachments[0].destinationRGBBlendFactor = .one
        desc.colorAttachments[0].rgbBlendOperation = .add
        desc.colorAttachments[0].sourceAlphaBlendFactor = .one
        desc.colorAttachments[0].destinationAlphaBlendFactor = .one
        pipeline = try device.makeRenderPipelineState(descriptor: desc)
        instanceBuffer = device.makeBuffer(length: 4096, options: .storageModeShared)!
    }

    private func ensureCapacity(_ count: Int) {
        guard count > instanceCapacity else { return }
        instanceCapacity = max(count, instanceCapacity * 2, 1024)
        instanceBuffer = device.makeBuffer(
            length: instanceCapacity * MemoryLayout<StarInstance>.stride,
            options: .storageModeShared)!
    }

    /// Encodes the star field into `pass`'s render encoder.
    func encodeStars(_ stars: [Star], camera: Camera,
                     viewport: (w: Float, h: Float),
                     to encoder: MTLRenderCommandEncoder) {
        guard !stars.isEmpty else { return }
        ensureCapacity(stars.count)
        let ptr = instanceBuffer.contents().bindMemory(to: StarInstance.self,
                                                       capacity: stars.count)
        for (i, s) in stars.enumerated() {
            ptr[i] = StarInstance(x: s.x, y: s.y, flux: s.flux, pad: 0)
        }
        var u = Uniforms(centerX: camera.centerX, centerY: camera.centerY,
                         viewportW: viewport.w, viewportH: viewport.h,
                         scale: camera.scale,
                         sigma: Photometry.psfSigma,
                         halfSize: Photometry.quadHalfSize,
                         exposure: exposure)
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(instanceBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
        encoder.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0,
                               vertexCount: 6, instanceCount: stars.count)
    }
}

enum StarPreviewerError: Error {
    case metalUnavailable
}
