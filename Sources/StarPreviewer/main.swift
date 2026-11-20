import AppKit
import MetalKit
import StarCore

if CommandLine.arguments.contains("--verify") {
    do {
        let verifier = try Verifier()
        exit(verifier.run() ? 0 : 1)
    } catch {
        print("verify failed to initialize: \(error)")
        exit(2)
    }
}

final class StarView: MTKView, MTKViewDelegate {
    let renderer: Renderer
    let catalog = CalibrationCluster.makeCatalog()
    var camera = Camera()
    var jitterEnabled = false

    init(frame: CGRect, device: MTLDevice) throws {
        renderer = try Renderer(device: device, pixelFormat: .bgra8Unorm)
        super.init(frame: frame, device: device)
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 1)
        delegate = self
        preferredFramesPerSecond = 60
        isPaused = false
        enableSetNeedsDisplay = false
    }
    required init(coder: NSCoder) { fatalError() }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let pass = currentRenderPassDescriptor, let drawable = currentDrawable else { return }
        var cam = camera
        if jitterEnabled {
            // Simulated camera shake: sub-pixel offsets every frame. With the
            // integral kernel, star brightness stays constant through this.
            cam.panByScreenPixels(dx: Float.random(in: -0.5...0.5),
                                  dy: Float.random(in: -0.5...0.5))
        }
        let w = Float(drawableSize.width), h = Float(drawableSize.height)
        let stars = DensityCuller.visibleStars(catalog: catalog, camera: cam,
                                               viewportW: w, viewportH: h)
        let cmd = renderer.queue.makeCommandBuffer()!
        let enc = cmd.makeRenderCommandEncoder(descriptor: pass)!
        renderer.encodeStars(stars, camera: cam, viewport: (w, h), to: enc)
        enc.endEncoding()
        cmd.present(drawable)
        cmd.commit()
    }

    override func scrollWheel(with event: NSEvent) {
        camera.zoom(by: event.scrollingDeltaY > 0 ? 1.08 : 1 / 1.08)
    }
    override func mouseDragged(with event: NSEvent) {
        camera.panByScreenPixels(dx: Float(-event.deltaX), dy: Float(event.deltaY))
    }
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) {
        switch event.charactersIgnoringModifiers {
        case "j":
            jitterEnabled.toggle()
            print("jitter \(jitterEnabled ? "on" : "off")")
        case "v":
            if let v = try? Verifier() { _ = v.run() }
        case "+", "=":
            renderer.exposure *= 1.25
        case "-":
            renderer.exposure /= 1.25
        default:
            super.keyDown(with: event)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    func applicationDidFinishLaunching(_ n: Notification) {
        guard let device = MTLCreateSystemDefault() else {
            fatalError("Metal is not available on this machine")
        }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
                          styleMask: [.titled, .closable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Metal Star Previewer - drag pan / scroll zoom / j jitter / v verify"
        window.contentView = try! StarView(frame: window.contentLayoutRect, device: device)
        window.center()
        window.makeKeyAndOrderFront(nil)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
