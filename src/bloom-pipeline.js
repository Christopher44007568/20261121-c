// HDR bloom pipeline built from explicit fullscreen passes:
//
//   scene-hdr (rgba16float)
//     -> soft-knee threshold prefilter
//     -> mip0..mipN downsample chain   (naive nearest OR improved 2x2 area box)
//     -> mipN..mip0 upsample + add     (naive nearest OR improved 9-tap tent)
//     -> composite HDR = scene + bloom * strength   (still rgba16float)
//     -> exposure + tonemap + sRGB     (exposure happens only here)
//
// Every HDR intermediate is rgba16float, so no clipping or gamma is baked
// into the bloom accumulation.

const fs = require('fs');
const path = require('path');
const { decodeHalfBuffer } = require('./half-float');

const SHADER_DIR = path.join(__dirname, 'shaders');

function loadShader(name) {
  return fs.readFileSync(path.join(SHADER_DIR, name), 'utf8');
}

const F32_PER_PARAMS = 12;

class FullscreenPass {
  constructor(device, code, entryPoint, bindLayout, targetFormat = 'rgba16float') {
    this.device = device;
    const module = device.createShaderModule({ code });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [bindLayout],
    });
    this.pipeline = device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: 'vs_fullscreen' },
      fragment: {
        module,
        entryPoint,
        targets: [{ format: targetFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  run(bindGroup, targetView, encoder) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}

class BloomPipeline {
  constructor(device, config) {
    this.device = device;
    this.config = config;
    this.format = 'rgba16float';
    this._buildLayouts();
    this._buildPipelines();
    this._buildTextures();
  }

  _buildLayouts() {
    const { device } = this;
    const samplerEntry = {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float', format: this.format },
    };

    this.layoutOneTexOneUbo = device.createBindGroupLayout({
      entries: [
        samplerEntry,
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.layoutTwoTexOneUbo = device.createBindGroupLayout({
      entries: [
        samplerEntry,
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', format: this.format },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this.paramsBuffer = device.createBuffer({
      size: F32_PER_PARAMS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sceneBuffer = device.createBuffer({
      size: 12 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _buildPipelines() {
    const sceneCode = loadShader('scene.wgsl');
    const prefilterCode = loadShader('prefilter.wgsl');
    const downCode = loadShader('downsample.wgsl');
    const upCode = loadShader('upsample.wgsl');
    const compositeCode = loadShader('composite.wgsl');
    const tonemapCode = loadShader('tonemap.wgsl');

    this.scenePass = new FullscreenPass(
      this.device, sceneCode, 'fs_scene', this._sceneBindLayout(),
    );
    this.prefilterPass = new FullscreenPass(
      this.device, prefilterCode, 'fs_prefilter', this.layoutOneTexOneUbo,
    );
    this.downNaive = new FullscreenPass(
      this.device, downCode, 'fs_naive', this.layoutOneTexOneUbo,
    );
    this.downImproved = new FullscreenPass(
      this.device, downCode, 'fs_improved', this.layoutOneTexOneUbo,
    );
    this.upNaive = new FullscreenPass(
      this.device, upCode, 'fs_naive', this.layoutTwoTexOneUbo,
    );
    this.upImproved = new FullscreenPass(
      this.device, upCode, 'fs_improved', this.layoutTwoTexOneUbo,
    );
    this.compositePass = new FullscreenPass(
      this.device, compositeCode, 'fs_composite', this.layoutTwoTexOneUbo,
    );
    // Tonemap writes an 8-bit display target.
    this.tonemapPass = new FullscreenPass(
      this.device, tonemapCode, 'fs_tonemap', this.layoutOneTexOneUbo, 'rgba8unorm',
    );
  }

  _sceneBindLayout() {
    if (!this._sceneLayout) {
      this._sceneLayout = this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });
    }
    return this._sceneLayout;
  }

  _makeTexture(width, height, label) {
    return this.device.createTexture({
      label,
      size: { width, height },
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  }

  _buildTextures() {
    const { width, height, mipLevels } = this.config;
    this.sceneTexture = this._makeTexture(width, height, 'scene-hdr');
    this.compositeTexture = this._makeTexture(width, height, 'composite-hdr');

    this.mips = [];
    for (let level = 0; level < mipLevels; level += 1) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      this.mips.push({
        level,
        width: w,
        height: h,
        down: this._makeTexture(w, h, `mip${level}-down`),
        up: this._makeTexture(w, h, `mip${level}-up`),
        upScratch: this._makeTexture(w, h, `mip${level}-up-scratch`),
      });
    }

    // 8-bit display target for the final tonemapped frame.
    this.displayTexture = this.device.createTexture({
      label: 'display-srgb',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    // Persistent, reused readback buffers. Creating/destroying MAP_READ
    // buffers every frame destabilizes the llvmpipe/Dawn allocator here.
    const fullRow = Math.ceil((width * 4 * 2) / 256) * 256;
    this.readbackBuffer = this.device.createBuffer({
      label: 'readback',
      size: fullRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const coarsest = this.mips[this.mips.length - 1];
    const coarseRow = Math.ceil((coarsest.width * 4 * 2) / 256) * 256;
    this.mipReadbackBuffer = this.device.createBuffer({
      label: 'mip-readback',
      size: coarseRow * coarsest.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  _writeParams(width, height) {
    const { threshold, knee, bloomStrength, exposure } = this.config;
    const data = new Float32Array(F32_PER_PARAMS);
    data.set([
      1 / width, 1 / height,
      threshold,
      knee,
      bloomStrength,
      exposure,
      0, 0,
      0, 0, 0, 0,
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
  }

  _bindOneTex(texture) {
    return this.device.createBindGroup({
      layout: this.layoutOneTexOneUbo,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
      ],
    });
  }

  _bindTwoTex(textureA, textureB) {
    return this.device.createBindGroup({
      layout: this.layoutTwoTexOneUbo,
      entries: [
        { binding: 0, resource: textureA.createView() },
        { binding: 1, resource: textureB.createView() },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });
  }

  _renderScene(lineX, encoder) {
    const { width, height, line, grayTarget } = this.config;
    const full = new Float32Array(12);
    full.set([
      width, height,
      lineX,
      line.width,
      line.energy,
      grayTarget,
      0,
      line.tint[0], line.tint[1],
      line.tint[2],
      0,
    ]);
    this.device.queue.writeBuffer(this.sceneBuffer, 0, full);

    const bindGroup = this.device.createBindGroup({
      layout: this._sceneBindLayout(),
      entries: [{ binding: 0, resource: { buffer: this.sceneBuffer } }],
    });
    this.scenePass.run(bindGroup, this.sceneTexture.createView(), encoder);
  }

  // Runs one full bloom variant (`naive` or `improved`) for a given line
  // position. Returns references to the HDR textures for measurement.
  renderFrame(lineX, variant) {
    const { device, mips } = this;
    const improved = variant === 'improved';
    const downPass = improved ? this.downImproved : this.downNaive;
    const upPass = improved ? this.upImproved : this.upNaive;

    this._writeParams(this.config.width, this.config.height);

    const encoder = device.createCommandEncoder();
    this._renderScene(lineX, encoder);

    // Soft-knee threshold prefilter into mip0-down.
    this.prefilterPass.run(
      this._bindOneTex(this.sceneTexture),
      mips[0].down.createView(),
      encoder,
    );

    // Downsample chain.
    for (let level = 1; level < mips.length; level += 1) {
      this._writeParams(mips[level - 1].width, mips[level - 1].height);
      downPass.run(
        this._bindOneTex(mips[level - 1].down),
        mips[level].down.createView(),
        encoder,
      );
    }

    // Start the upsample chain from the coarsest downsampled mip.
    const last = mips.length - 1;
    encoder.copyTextureToTexture(
      { texture: mips[last].down },
      { texture: mips[last].up },
      { width: mips[last].width, height: mips[last].height },
    );

    for (let level = last - 1; level >= 0; level -= 1) {
      this._writeParams(mips[level].width, mips[level].height);
      // Filter the coarser accumulated `up` mip, add THIS level's down
      // mip (its own frequency band), write to scratch, then copy back.
      upPass.run(
        this._bindTwoTex(mips[level + 1].up, mips[level].down),
        mips[level].upScratch.createView(),
        encoder,
      );
      encoder.copyTextureToTexture(
        { texture: mips[level].upScratch },
        { texture: mips[level].up },
        { width: mips[level].width, height: mips[level].height },
      );
    }

    // HDR composite (no exposure yet).
    this._writeParams(this.config.width, this.config.height);
    this.compositePass.run(
      this._bindTwoTex(this.sceneTexture, mips[0].up),
      this.compositeTexture.createView(),
      encoder,
    );

    // Exposure + tonemap only at the final display pass.
    this.tonemapPass.run(
      this._bindOneTex(this.compositeTexture),
      this.displayTexture.createView(),
      encoder,
    );

    device.queue.submit([encoder.finish()]);

    return {
      scene: this.sceneTexture,
      bloomMip0: mips[0].up,
      bloomCoarsest: mips[last].down,
      composite: this.compositeTexture,
      display: this.displayTexture,
      coarsest: mips[last],
    };
  }

  async readTexture(texture, { buffer } = {}) {
    const { device } = this;
    const width = texture.width ?? this.config.width;
    const height = texture.height ?? this.config.height;
    const bytesPerRow = Math.ceil((width * 4 * 2) / 256) * 256;
    const fits = bytesPerRow * height <= this.readbackBuffer.size;
    const target = buffer || (fits ? this.readbackBuffer : device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }));
    const ownsTarget = !buffer && !fits;
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: target, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    device.queue.submit([encoder.finish()]);
    await target.mapAsync(GPUMapMode.READ);
    const raw = Buffer.from(target.getMappedRange().slice(0));
    target.unmap();
    if (ownsTarget) {
      target.destroy();
    }
    // rgba16float texels are 2 bytes/channel; remove 256-byte row padding
    // and decode the packed half-float words into Float32.
    const tight = new Float32Array(width * height * 4);
    const rowWords = width * 4;
    const rowBytes = rowWords * 2;
    for (let y = 0; y < height; y += 1) {
      const rowU16 = new Uint16Array(
        raw.buffer, raw.byteOffset + y * bytesPerRow, rowWords,
      );
      tight.set(decodeHalfBuffer(rowU16), y * rowWords);
    }
    return { data: tight, width, height };
  }

  async readCoarsestMip(texture) {
    const mip = this.mips[this.mips.length - 1];
    const rowWords = mip.width * 4;
    const bytesPerRow = Math.ceil((rowWords * 2) / 256) * 256;
    const { device } = this;
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: this.mipReadbackBuffer, bytesPerRow, rowsPerImage: mip.height },
      { width: mip.width, height: mip.height },
    );
    device.queue.submit([encoder.finish()]);
    await this.mipReadbackBuffer.mapAsync(GPUMapMode.READ);
    const raw = Buffer.from(this.mipReadbackBuffer.getMappedRange().slice(0));
    this.mipReadbackBuffer.unmap();
    const data = new Float32Array(mip.width * mip.height * 4);
    for (let y = 0; y < mip.height; y += 1) {
      const rowU16 = new Uint16Array(
        raw.buffer, raw.byteOffset + y * bytesPerRow, rowWords,
      );
      data.set(decodeHalfBuffer(rowU16), y * rowWords);
    }
    return data;
  }
}

module.exports = { BloomPipeline, loadShader };
