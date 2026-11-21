import {
  advectShader,
  auditShader,
  compositeShader,
  maskShader,
  seedShader,
} from "./shaders.js";

const UNIFORM_BYTES = 48;
const MAIN_FORMAT = "rgba16float";
const AUDIT_FORMAT = "rgba8unorm";
const AUDIT_SIZE = { width: 480, height: 300 };
const MASK_SIZE = { width: 300, height: 200 };
const COMPOSITE_FLAGS = {
  vectors: 1,
  obstacle: 2,
  missing: 4,
};

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function packUniform({
  width,
  height,
  time,
  dt,
  aspect,
  seed,
  flags,
  viewMode,
  probe,
  speedScale,
}) {
  const buffer = new ArrayBuffer(UNIFORM_BYTES);
  const floats = new Float32Array(buffer);
  const integers = new Uint32Array(buffer);
  floats[0] = width;
  floats[1] = height;
  floats[2] = time;
  floats[3] = dt;
  floats[4] = aspect;
  floats[5] = seed;
  integers[6] = flags;
  integers[7] = viewMode;
  floats[8] = probe.x;
  floats[9] = probe.y;
  floats[10] = speedScale;
  floats[11] = 0;
  return buffer;
}

function packFlags(options) {
  let flags = 0;
  if (options.vectors) flags |= COMPOSITE_FLAGS.vectors;
  if (options.obstacle) flags |= COMPOSITE_FLAGS.obstacle;
  if (options.missing) flags |= COMPOSITE_FLAGS.missing;
  return flags;
}

export class WebGPUFieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.format = null;
    this.pipelines = {};
    this.sampler = null;
    this.main = null;
    this.width = 1;
    this.height = 1;
    this.aspect = 1.5;
    this.seed = 7.13;
    this.audit = null;
    this.auditPreview = null;
    this.flags = 7;
    this.probe = { x: -0.55, y: 0.18 };
    this.ready = false;
    this.destroyed = false;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this browser.");
    }
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!this.adapter) {
      throw new Error("No compatible WebGPU adapter was found.");
    }
    this.device = await this.adapter.requestDevice();
    this.device.lost.then((info) => {
      this.ready = false;
      this.onDeviceLost?.(info);
    });

    this.context = this.canvas.getContext("webgpu");
    if (!this.context) {
      throw new Error("Unable to create a WebGPU canvas context.");
    }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.createPipelines();
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.ready = true;
    return {
      adapter: this.adapter.info ?? null,
      format: this.format,
    };
  }

  createPipelines() {
    const create = (fragmentCode, format) => {
      const module = this.device.createShaderModule({ code: fragmentCode });
      return this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: {
          module,
          entryPoint: "fragmentMain",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
    };

    this.pipelines.seed = create(seedShader, MAIN_FORMAT);
    this.pipelines.advect = create(advectShader, MAIN_FORMAT);
    this.pipelines.composite = create(compositeShader, this.format);
    this.pipelines.auditSeed = create(seedShader, AUDIT_FORMAT);
    this.pipelines.auditAdvect = create(advectShader, AUDIT_FORMAT);
    this.pipelines.auditPreview = create(auditShader, this.format);
    this.pipelines.mask = create(maskShader, AUDIT_FORMAT);
  }

  resize(cssWidth, cssHeight) {
    if (!this.ready && !this.device) return;
    const cssW = Math.max(320, Math.floor(cssWidth || 320));
    const cssH = Math.max(260, Math.floor(cssHeight || 260));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(cssW * dpr));
    const height = Math.max(260, Math.floor(cssH * dpr));
    if (width === this.width && height === this.height && this.main) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;
    this.aspect = width / height;

    if (this.main) {
      for (const texture of [this.main.front, this.main.back]) {
        texture.destroy();
      }
    }

    const textureUsage =
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    const makeTexture = (format) =>
      this.device.createTexture({
        size: [width, height],
        format,
        usage: textureUsage,
      });

    const front = makeTexture(MAIN_FORMAT);
    const back = makeTexture(MAIN_FORMAT);
    const advectLayout = this.pipelines.advect.getBindGroupLayout(0);
    const compositeLayout = this.pipelines.composite.getBindGroupLayout(0);

    this.main = {
      front,
      back,
      frontView: front.createView(),
      backView: back.createView(),
      advectGroups: [
        this.device.createBindGroup({
          layout: advectLayout,
          entries: [
            { binding: 0, resource: { buffer: this.advectUniforms() } },
            { binding: 1, resource: front.createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
        this.device.createBindGroup({
          layout: advectLayout,
          entries: [
            { binding: 0, resource: { buffer: this.advectUniforms() } },
            { binding: 1, resource: back.createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
      ],
      compositeGroups: [
        this.device.createBindGroup({
          layout: compositeLayout,
          entries: [
            { binding: 0, resource: { buffer: this.compositeUniforms() } },
            { binding: 1, resource: front.createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
        this.device.createBindGroup({
          layout: compositeLayout,
          entries: [
            { binding: 0, resource: { buffer: this.compositeUniforms() } },
            { binding: 1, resource: back.createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
      ],
      current: 0,
    };
    this.seedMain();
  }

  advectUniforms() {
    if (!this._advectUniforms) {
      this._advectUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    return this._advectUniforms;
  }

  compositeUniforms() {
    if (!this._compositeUniforms) {
      this._compositeUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    return this._compositeUniforms;
  }

  writeAdvectUniforms({ time, dt, flags = this.flags }) {
    const data = packUniform({
      width: this.width,
      height: this.height,
      time,
      dt,
      aspect: this.aspect,
      seed: this.seed,
      flags,
      viewMode: 0,
      probe: this.probe,
      speedScale: 1,
    });
    this.device.queue.writeBuffer(this.advectUniforms(), 0, data);
  }

  writeCompositeUniforms({
    time,
    dt = 0,
    flags = this.flags,
    viewMode = 0,
    width = this.width,
    height = this.height,
  }) {
    const data = packUniform({
      width,
      height,
      time,
      dt,
      aspect: width / height,
      seed: this.seed,
      flags,
      viewMode,
      probe: this.probe,
      speedScale: 1,
    });
    this.device.queue.writeBuffer(this.compositeUniforms(), 0, data);
  }

  seedMain() {
    const front = this.textureView(this.main, 1);
    const back = this.textureView(this.main, 0);
    this.writeAdvectUniforms({ time: 0, dt: 0 });
    const layout = this.pipelines.seed.getBindGroupLayout(0);
    const seedGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.advectUniforms() } }],
    });
    const encoder = this.device.createCommandEncoder();
    for (const view of [front, back]) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.pipelines.seed);
      pass.setBindGroup(0, seedGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
    this.main.current = 0;
  }

  textureView(state, index) {
    return index === 0 ? state.frontView : state.backView;
  }

  setOptions(options) {
    this.flags = packFlags(options);
  }

  setProbe(probe) {
    this.probe = { x: probe.x, y: probe.y };
  }

  step(dt, time) {
    if (!this.ready || !this.main) return;
    const from = this.main.current;
    const to = 1 - from;
    const targetView = this.textureView(this.main, to);
    this.writeAdvectUniforms({ time, dt });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.advect);
    pass.setBindGroup(0, this.main.advectGroups[from]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.main.current = to;
  }

  render({ time, dt = 0, viewMode = 0 }) {
    if (!this.ready || !this.main) return;
    this.writeCompositeUniforms({ time, dt, viewMode });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.003, g: 0.006, b: 0.009, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.composite);
    pass.setBindGroup(0, this.main.compositeGroups[this.main.current]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  renderAudit(time = 0) {
    if (!this.ready || !this.auditPreview) return;
    const data = packUniform({
      width: this.width,
      height: this.height,
      time,
      dt: 0,
      aspect: this.aspect,
      seed: this.seed,
      flags: this.flags,
      viewMode: 1,
      probe: this.probe,
      speedScale: 1,
    });
    if (!this._auditPreviewUniforms) {
      this._auditPreviewUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this._auditPreviewUniforms, 0, data);

    if (this._auditPreviewDirty) {
      const layout = this.pipelines.auditPreview.getBindGroupLayout(0);
      this.auditPreview.bindGroup = this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this._auditPreviewUniforms } },
          { binding: 1, resource: this.auditPreview.coarse.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: this.auditPreview.fine.createView() },
        ],
      });
      this._auditPreviewDirty = false;
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.003, g: 0.006, b: 0.009, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.auditPreview);
    pass.setBindGroup(0, this.auditPreview.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  createAuditPair() {
    if (!this._auditUniforms) {
      this._auditUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC;
    const makeTexture = () =>
      this.device.createTexture({
        size: [AUDIT_SIZE.width, AUDIT_SIZE.height],
        format: AUDIT_FORMAT,
        usage,
      });
    const front = makeTexture();
    const back = makeTexture();
    const layout = this.pipelines.auditAdvect.getBindGroupLayout(0);
    const makeGroup = (texture) =>
      this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this._auditUniforms } },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: this.sampler },
        ],
      });
    return {
      front,
      back,
      groups: [makeGroup(front), makeGroup(back)],
      current: 0,
      aspect: AUDIT_SIZE.width / AUDIT_SIZE.height,
    };
  }

  writeAuditUniform({ time, dt, flags = this.flags }) {
    const data = packUniform({
      width: AUDIT_SIZE.width,
      height: AUDIT_SIZE.height,
      time,
      dt,
      aspect: AUDIT_SIZE.width / AUDIT_SIZE.height,
      seed: this.seed,
      flags,
      viewMode: 1,
      probe: this.probe,
      speedScale: 1,
    });
    this.device.queue.writeBuffer(this._auditUniforms, 0, data);
  }

  async runAuditSequence(hz, duration, pair, onProgress, flags = this.flags) {
    this.writeAuditUniform({ time: 0, dt: 0, flags });
    const seedLayout = this.pipelines.auditSeed.getBindGroupLayout(0);
    const seedGroup = this.device.createBindGroup({
      layout: seedLayout,
      entries: [{ binding: 0, resource: { buffer: this._auditUniforms } }],
    });
    const seedEncoder = this.device.createCommandEncoder();
    const seedPass = seedEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: pair.front.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    seedPass.setPipeline(this.pipelines.auditSeed);
    seedPass.setBindGroup(0, seedGroup);
    seedPass.draw(3);
    seedPass.end();
    this.device.queue.submit([seedEncoder.finish()]);
    pair.current = 0;

    const steps = Math.round(duration * hz);
    const dt = duration / steps;
    for (let i = 1; i <= steps; i += 1) {
      const from = pair.current;
      const to = 1 - from;
      const target = to === 0 ? pair.front : pair.back;
      this.writeAuditUniform({ time: i * dt, dt, flags });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.pipelines.auditAdvect);
      pass.setBindGroup(0, pair.groups[from]);
      pass.draw(3);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      pair.current = to;
      if (onProgress && (i === 1 || i % 24 === 0 || i === steps)) {
        onProgress(i, steps);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }

    const currentTexture = pair.current === 0 ? pair.front : pair.back;
    const bytesPerRow = alignTo(AUDIT_SIZE.width * 4, 256);
    const readback = this.device.createBuffer({
      size: bytesPerRow * AUDIT_SIZE.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: currentTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { buffer: readback, offset: 0, bytesPerRow },
      { width: AUDIT_SIZE.width, height: AUDIT_SIZE.height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    return { readback, bytesPerRow, currentTexture };
  }

  async runFrameRateAudit({ coarseHz = 30, fineHz = 120, duration = 2 } = {}) {
    if (!this.ready) throw new Error("WebGPU renderer is not ready.");
    this.disposeAuditPreview();
    const flags = this.flags;
    const coarsePair = this.createAuditPair();
    const finePair = this.createAuditPair();
    this.onAuditProgress?.({ phase: "coarse", ratio: 0, hz: coarseHz });
    const coarseCapture = await this.runAuditSequence(
      coarseHz,
      duration,
      coarsePair,
      (step, total) => this.onAuditProgress?.({ phase: "coarse", ratio: step / total, hz: coarseHz }),
      flags,
    );
    this.onAuditProgress?.({ phase: "fine", ratio: 0, hz: fineHz });
    const fineCapture = await this.runAuditSequence(
      fineHz,
      duration,
      finePair,
      (step, total) => this.onAuditProgress?.({ phase: "fine", ratio: step / total, hz: fineHz }),
      flags,
    );

    await Promise.all([
      coarseCapture.readback.mapAsync(GPUMapMode.READ),
      fineCapture.readback.mapAsync(GPUMapMode.READ),
    ]);
    const coarseBytes = new Uint8Array(
      coarseCapture.readback.getMappedRange(),
    ).slice();
    const fineBytes = new Uint8Array(
      fineCapture.readback.getMappedRange(),
    ).slice();
    coarseCapture.readback.unmap();
    fineCapture.readback.unmap();
    coarseCapture.readback.destroy();
    fineCapture.readback.destroy();

    let sum = 0;
    let changed = 0;
    let max = 0;
    let total = 0;
    for (let y = 0; y < AUDIT_SIZE.height; y += 1) {
      const row = y * coarseCapture.bytesPerRow;
      for (let x = 0; x < AUDIT_SIZE.width; x += 1) {
        const offset = row + x * 4;
        const delta = Math.abs(coarseBytes[offset] - fineBytes[offset]) / 255;
        sum += delta;
        if (delta > 0.012) changed += 1;
        max = Math.max(max, delta);
        total += 1;
      }
    }

    this.audit = {
      coarsePair,
      finePair,
      coarseHz,
      fineHz,
      duration,
      time: duration,
      stepsCoarse: Math.round(duration * coarseHz),
      stepsFine: Math.round(duration * fineHz),
      meanAbsoluteDifference: sum / total,
      changedFraction: changed / total,
      maxDifference: max,
    };
    this.auditPreview = {
      coarse: coarseCapture.currentTexture,
      fine: fineCapture.currentTexture,
    };
    this._auditPreviewDirty = true;
    return this.audit;
  }

  disposeAuditPreview() {
    if (!this.audit) return;
    for (const pair of [this.audit.coarsePair, this.audit.finePair]) {
      pair.front.destroy();
      pair.back.destroy();
    }
    this.audit = null;
    this.auditPreview = null;
    this._auditPreviewDirty = true;
  }

  async runMaskAudit(probes, flags = this.flags) {
    if (!this.ready) throw new Error("WebGPU renderer is not ready.");
    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC;
    const texture = this.device.createTexture({
      size: [MASK_SIZE.width, MASK_SIZE.height],
      format: AUDIT_FORMAT,
      usage,
    });
    if (!this._maskUniforms) {
      this._maskUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    const aspect = MASK_SIZE.width / MASK_SIZE.height;
    const data = packUniform({
      width: MASK_SIZE.width,
      height: MASK_SIZE.height,
      time: 0,
      dt: 0,
      aspect,
      seed: this.seed,
      flags,
      viewMode: 0,
      probe: this.probe,
      speedScale: 1,
    });
    this.device.queue.writeBuffer(this._maskUniforms, 0, data);
    const layout = this.pipelines.mask.getBindGroupLayout(0);
    const group = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this._maskUniforms } }],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.mask);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();

    const bytesPerRow = 256;
    const readback = this.device.createBuffer({
      size: bytesPerRow * probes.length,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    probes.forEach((probe, index) => {
      const u = probe.x / aspect + 0.5;
      const v = 0.5 - probe.y;
      const px = Math.max(0, Math.min(MASK_SIZE.width - 1, Math.floor(u * MASK_SIZE.width)));
      const py = Math.max(0, Math.min(MASK_SIZE.height - 1, Math.floor(v * MASK_SIZE.height)));
      encoder.copyTextureToBuffer(
        { texture, mipLevel: 0, origin: { x: px, y: py, z: 0 } },
        { buffer: readback, offset: index * bytesPerRow, bytesPerRow },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    });
    this.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    readback.destroy();
    texture.destroy();

    const samples = probes.map((probe, index) => ({
      ...probe,
      actual: bytes[index * bytesPerRow],
    }));
    return {
      pass: samples.every((sample) => sample.actual === sample.expected),
      samples,
      resolution: { ...MASK_SIZE },
      aspect,
    };
  }

  async waitForIdle() {
    if (!this.device) return;
    await this.device.queue.onSubmittedWorkDone();
  }

  async captureComposite({ time, dt = 0, viewMode = 0, scale = 1 } = {}) {
    if (!this.ready || !this.main) throw new Error("Renderer is not ready.");
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));
    this.writeCompositeUniforms({ time, dt, viewMode, width, height });
    return this.captureWithPipeline(
      this.pipelines.composite,
      this.main.compositeGroups[this.main.current],
      width,
      height,
    );
  }

  ensureAuditPreviewBindGroup() {
    if (!this._auditPreviewUniforms) {
      this._auditPreviewUniforms = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    if (this._auditPreviewDirty) {
      const layout = this.pipelines.auditPreview.getBindGroupLayout(0);
      this.auditPreview.bindGroup = this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this._auditPreviewUniforms } },
          { binding: 1, resource: this.auditPreview.coarse.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: this.auditPreview.fine.createView() },
        ],
      });
      this._auditPreviewDirty = false;
    }
    return this.auditPreview.bindGroup;
  }

  async captureAudit({ time = 0, scale = 1 } = {}) {
    if (!this.ready || !this.auditPreview) throw new Error("Audit preview is not ready.");
    const bindGroup = this.ensureAuditPreviewBindGroup();
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));
    const data = packUniform({
      width,
      height,
      time,
      dt: 0,
      aspect: width / height,
      seed: this.seed,
      flags: this.flags,
      viewMode: 1,
      probe: this.probe,
      speedScale: 1,
    });
    this.device.queue.writeBuffer(this._auditPreviewUniforms, 0, data);
    return this.captureWithPipeline(this.pipelines.auditPreview, bindGroup, width, height);
  }

  async captureWithPipeline(pipeline, bindGroup, width = this.width, height = this.height) {
    const texture = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    const bytesPerRow = alignTo(width * 4, 256);
    const readback = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { buffer: readback, offset: 0, bytesPerRow },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    readback.destroy();
    texture.destroy();
    return { bytes, width, height, bytesPerRow };
  }

  destroy() {
    this.destroyed = true;
    this.ready = false;
    this.disposeAuditPreview();
    if (this.main) {
      this.main.front.destroy();
      this.main.back.destroy();
      this.main = null;
    }
    this.device?.destroy();
  }
}
