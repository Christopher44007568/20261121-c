import { WGSL } from "./shaders.js";
import { boardBounds, lightCenter } from "./scene.js";

const UNIFORM_FLOATS = 44;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;
const ACCUM_FORMAT = "rgba8unorm";

export class PenumbraRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = null;
    this.device = null;
    this.format = null;
    this.ready = false;
    this.referenceValid = false;
    this.frame = 0;
    this.width = 0;
    this.height = 0;
    this.refWidth = 0;
    this.refHeight = 0;
    this.readIndex = 0;
    this.resetNext = true;
    this.adapterInfo = null;
    this.gpuError = null;
    this.maxTextureSize = 2048;
    this.mainUniform = new Float32Array(UNIFORM_FLOATS);
    this.refUniform = new Float32Array(UNIFORM_FLOATS);
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error("当前浏览器没有暴露 navigator.gpu");
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("未找到可用的 WebGPU 适配器");
    this.adapterInfo = adapter.info || null;
    const software = `${this.adapterInfo?.architecture || ""} ${this.adapterInfo?.vendor || ""}`.toLowerCase().includes("swiftshader");
    this.renderScale = software ? 0.62 : 1;
    this.referenceScale = software ? 0.42 : 0.55;
    this.device = await adapter.requestDevice();
    this.maxTextureSize = this.device.limits.maxTextureDimension2D || 2048;
    this.device.lost.then((info) => {
      this.gpuError = info.message || "WebGPU device lost";
      this.ready = false;
    });

    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw new Error("无法创建 WebGPU canvas context");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque"
    });

    this.createResources();
    this.ready = true;
    this.resize(true);
    return this;
  }

  createResources() {
    this.shader = this.device.createShaderModule({ label: "penumbra-shader", code: WGSL });

    this.accumLayout = this.device.createBindGroupLayout({
      label: "accumulation-layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    });
    this.referenceLayout = this.device.createBindGroupLayout({
      label: "reference-layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
      ]
    });

    this.accumUniform = this.device.createBuffer({
      label: "main-uniform",
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.refUniformBuffer = this.device.createBuffer({
      label: "reference-uniform",
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.sampler = this.device.createSampler({
      label: "linear-clamp",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    const accumPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.accumLayout]
    });
    const finalPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.accumLayout, this.referenceLayout]
    });
    this.accumPipeline = this.device.createRenderPipeline({
      label: "accumulation-pipeline",
      layout: accumPipelineLayout,
      vertex: { module: this.shader, entryPoint: "vs_main" },
      fragment: {
        module: this.shader,
        entryPoint: "fs_accum",
        targets: [{ format: ACCUM_FORMAT }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.referencePipeline = this.device.createRenderPipeline({
      label: "reference-pipeline",
      layout: accumPipelineLayout,
      vertex: { module: this.shader, entryPoint: "vs_main" },
      fragment: {
        module: this.shader,
        entryPoint: "fs_reference",
        targets: [{ format: ACCUM_FORMAT }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.finalPipeline = this.device.createRenderPipeline({
      label: "final-pipeline",
      layout: finalPipelineLayout,
      vertex: { module: this.shader, entryPoint: "vs_main" },
      fragment: {
        module: this.shader,
        entryPoint: "fs_final",
        targets: [{ format: this.format }]
      },
      primitive: { topology: "triangle-list" }
    });

    this.dummyTexture = this.device.createTexture({
      label: "dummy-previous",
      size: [1, 1],
      format: ACCUM_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    this.dummyRefBindGroup = this.device.createBindGroup({
      label: "reference-input",
      layout: this.accumLayout,
      entries: [
        { binding: 0, resource: { buffer: this.refUniformBuffer } },
        { binding: 1, resource: this.dummyTexture.createView() },
        { binding: 2, resource: this.sampler }
      ]
    });
  }

  createTargetTexture(width, height, label) {
    return this.device.createTexture({
      label,
      size: [Math.max(1, width), Math.max(1, height)],
      format: ACCUM_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC
    });
  }

  resize(force = false) {
    if (!this.ready && !this.device) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.max(1, Math.min(this.maxTextureSize, Math.round(rect.width * dpr * this.renderScale)));
    const height = Math.max(1, Math.min(this.maxTextureSize, Math.round(rect.height * dpr * this.renderScale)));
    if (!force && width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.refWidth = Math.max(1, Math.round(width * this.referenceScale));
    this.refHeight = Math.max(1, Math.round(height * this.referenceScale));
    this.canvas.width = width;
    this.canvas.height = height;

    this.accumTextures?.forEach((texture) => texture.destroy());
    this.referenceTexture?.destroy();
    this.accumTextures = [
      this.createTargetTexture(width, height, "visibility-ping"),
      this.createTargetTexture(width, height, "visibility-pong")
    ];
    this.referenceTexture = this.createTargetTexture(this.refWidth, this.refHeight, "offline-reference");
    this.accumViews = this.accumTextures.map((texture) => texture.createView());
    this.refView = this.referenceTexture.createView();
    this.referenceInput = this.device.createBindGroup({
      label: "reference-texture",
      layout: this.referenceLayout,
      entries: [{ binding: 0, resource: this.refView }]
    });
    this.accumBindGroups = [0, 1].map((writeIndex) =>
      this.device.createBindGroup({
        label: `accumulate-${writeIndex}`,
        layout: this.accumLayout,
        entries: [
          { binding: 0, resource: { buffer: this.accumUniform } },
          { binding: 1, resource: this.accumViews[1 - writeIndex] },
          { binding: 2, resource: this.sampler }
        ]
      })
    );
    this.finalBindGroups = [0, 1].map((index) =>
      this.device.createBindGroup({
        label: `final-${index}`,
        layout: this.accumLayout,
        entries: [
          { binding: 0, resource: { buffer: this.accumUniform } },
          { binding: 1, resource: this.accumViews[index] },
          { binding: 2, resource: this.sampler }
        ]
      })
    );
    this.finalReferenceBindGroups = [0, 1].map((index) =>
      this.device.createBindGroup({
        label: `final-reference-${index}`,
        layout: this.referenceLayout,
        entries: [{ binding: 0, resource: this.refView }]
      })
    );
    this.referenceValid = false;
    this.readIndex = 0;
    this.resetNext = true;
  }

  writeSceneUniform(target, state, camera, width, height, mode, frame, reset, referenceValid) {
    const center = lightCenter(state);
    const bounds = boardBounds(state);
    target.fill(0);
    const put = (index, x, y, z, w) => {
      target[index * 4] = x;
      target[index * 4 + 1] = y;
      target[index * 4 + 2] = z;
      target[index * 4 + 3] = w;
    };
    put(0, camera.position[0], camera.position[1], camera.position[2], frame * 0.016);
    put(1, camera.right[0], camera.right[1], camera.right[2], camera.tanHalfFov);
    put(2, camera.up[0], camera.up[1], camera.up[2], camera.aspect);
    put(3, camera.forward[0], camera.forward[1], camera.forward[2], frame);
    put(4, center[0], center[1], center[2], 1);
    put(5, state.lightWidth * 0.5, state.lightDepth * 0.5, 0, 0);
    put(6, 0, state.boardWidth * 0.5, bounds.min[1], bounds.max[1]);
    put(7, state.boardOffset, 0.075, 0, 0);
    put(8, frame, state.sampleRate, reset ? 1 : 0, state.historyAlpha);
    put(9, width, height, mode, 0);
    put(10, this.refWidth, this.refHeight, referenceValid ? 1 : 0, 0);
  }

  invalidateReference() {
    this.referenceValid = false;
  }

  requestHistoryReset() {
    this.resetNext = true;
  }

  render({ state, camera, mode = 0, computeReference = false }) {
    if (!this.ready) return false;
    this.resize();
    if (this.width < 2 || this.height < 2) return false;

    const encoder = this.device.createCommandEncoder({ label: "penumbra-frame" });
    if (computeReference) {
      this.writeSceneUniform(
        this.refUniform,
        state,
        camera,
        this.refWidth,
        this.refHeight,
        0,
        this.frame,
        true,
        true
      );
      this.device.queue.writeBuffer(this.refUniformBuffer, 0, this.refUniform);
      const referencePass = encoder.beginRenderPass({
        label: "offline-reference-pass",
        colorAttachments: [
          {
            view: this.refView,
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store"
          }
        ]
      });
      referencePass.setPipeline(this.referencePipeline);
      referencePass.setBindGroup(0, this.dummyRefBindGroup);
      referencePass.draw(3);
      referencePass.end();
      this.referenceValid = true;
    }

    this.frame += 1;
    const reset = this.resetNext;
    this.resetNext = false;
    this.writeSceneUniform(
      this.mainUniform,
      state,
      camera,
      this.width,
      this.height,
      mode,
      this.frame,
      reset,
      this.referenceValid
    );
    this.device.queue.writeBuffer(this.accumUniform, 0, this.mainUniform);

    const writeIndex = 1 - this.readIndex;
    const accumulationPass = encoder.beginRenderPass({
      label: "stochastic-visibility-pass",
      colorAttachments: [
        {
          view: this.accumViews[writeIndex],
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store"
        }
      ]
    });
    accumulationPass.setPipeline(this.accumPipeline);
    accumulationPass.setBindGroup(0, this.accumBindGroups[writeIndex]);
    accumulationPass.draw(3);
    accumulationPass.end();

    const finalPass = encoder.beginRenderPass({
      label: "display-pass",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.02, g: 0.027, b: 0.036, a: 1 },
          storeOp: "store"
        }
      ]
    });
    finalPass.setPipeline(this.finalPipeline);
    finalPass.setBindGroup(0, this.finalBindGroups[writeIndex]);
    finalPass.setBindGroup(1, this.finalReferenceBindGroups[writeIndex]);
    finalPass.draw(3);
    finalPass.end();

    this.device.queue.submit([encoder.finish()]);
    this.readIndex = writeIndex;
    return true;
  }

  getInfo() {
    if (!this.adapterInfo) return "WEBGPU · ADAPTER READY";
    const vendor = this.adapterInfo.vendor || "unknown";
    const architecture = this.adapterInfo.architecture || "unknown";
    return `WEBGPU · ${vendor.toUpperCase()} / ${architecture.toUpperCase()}`;
  }
}
