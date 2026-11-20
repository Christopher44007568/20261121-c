import {
  brushFragment,
  brushVertex,
  fluxFragment,
  fullscreenVertex,
  integrateFragment,
  paperFragment,
  presentFragment
} from "./shaders.js";

const SIM_WIDTH = 960;
const SIM_HEIGHT = 640;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function uniformMap(gl, program, names) {
  const map = {};
  for (const name of names) map[name] = gl.getUniformLocation(program, name);
  return map;
}

function createTexture(gl, width, height, internalFormat, format, type, filter = gl.LINEAR) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  return texture;
}

function createFramebuffer(gl, textures) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  textures.forEach((texture, index) => {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0 + index,
      gl.TEXTURE_2D,
      texture,
      0
    );
  });
  if (textures.length > 1) {
    gl.drawBuffers(textures.map((_, index) => gl.COLOR_ATTACHMENT0 + index));
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return framebuffer;
}

function bindTexture(gl, unit, texture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  return unit;
}

function readFloatTexture(gl, framebuffer, texture, x, y, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  const output = new Float32Array(width * height * 4);
  gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, output);
  return output;
}

export class InkSimulation {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = SIM_WIDTH;
    this.height = SIM_HEIGHT;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.showFibers = true;
    this.fiberAngle = (18 * Math.PI) / 180;
    this.fiberAnisotropy = 0.72;
    this.evaporation = 0.0052;
    this.depositRate = 0.0085;
    this.liftRate = 0.002;
    this.pigmentMobility = 0.11;
    this.waterMobility = 0.1;
    this.substeps = 3;
    this.mobileIndex = 0;
    this.depositIndex = 0;
    this.statsReads = 0;
  }

  init() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });
    if (!gl) throw new Error("当前环境不支持 WebGL2");
    this.gl = gl;
    this.floatRender = gl.getExtension("EXT_color_buffer_float");
    if (!this.floatRender) throw new Error("当前 GPU 不支持浮点渲染目标 EXT_color_buffer_float");
    this.floatLinear = Boolean(gl.getExtension("OES_texture_float_linear"));

    this.programs = {
      paper: createProgram(gl, fullscreenVertex, paperFragment),
      flux: createProgram(gl, fullscreenVertex, fluxFragment),
      integrate: createProgram(gl, fullscreenVertex, integrateFragment),
      brush: createProgram(gl, brushVertex, brushFragment),
      present: createProgram(gl, fullscreenVertex, presentFragment)
    };
    this.uniforms = {
      paper: uniformMap(gl, this.programs.paper, ["uSize", "uAngle"]),
      flux: uniformMap(gl, this.programs.flux, [
        "uMobile",
        "uPaper",
        "uSize",
        "uDir",
        "uAnisotropy",
        "uPigmentMobility",
        "uWaterMobility"
      ]),
      integrate: uniformMap(gl, this.programs.integrate, [
        "uMobile",
        "uDeposit",
        "uFaceH",
        "uFaceV",
        "uPaper",
        "uSize",
        "uEvaporation",
        "uDepositRate",
        "uLiftRate"
      ]),
      brush: uniformMap(gl, this.programs.brush, ["uSize", "uMobile", "uDeposit", "uPaper"]),
      present: uniformMap(gl, this.programs.present, [
        "uMobile",
        "uDeposit",
        "uPaper",
        "uViewport",
        "uSimSize",
        "uPan",
        "uZoom",
        "uShowFibers"
      ])
    };

    this.createFullscreenQuad();
    this.createSimulationTargets();
    this.createExportTarget();
    this.generatePaper();
    this.reset();
    this.resizeCanvas();
    return this;
  }

  createFullscreenQuad() {
    const gl = this.gl;
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  createSimulationTargets() {
    const gl = this.gl;
    const filter = this.floatLinear ? gl.LINEAR : gl.NEAREST;
    const makeFloat = () =>
      createTexture(
        gl,
        this.width,
        this.height,
        gl.RGBA16F,
        gl.RGBA,
        gl.HALF_FLOAT,
        filter
      );

    this.mobile = [makeFloat(), makeFloat()];
    this.deposit = [makeFloat(), makeFloat()];
    this.faceH = makeFloat();
    this.faceV = makeFloat();
    this.paper = createTexture(
      gl,
      this.width,
      this.height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      gl.LINEAR
    );

    this.mobileFbo = [
      createFramebuffer(gl, [this.mobile[0]]),
      createFramebuffer(gl, [this.mobile[1]])
    ];
    this.depositFbo = [
      createFramebuffer(gl, [this.deposit[0]]),
      createFramebuffer(gl, [this.deposit[1]])
    ];
    this.faceHFbo = createFramebuffer(gl, [this.faceH]);
    this.faceVFbo = createFramebuffer(gl, [this.faceV]);
    this.paperFbo = createFramebuffer(gl, [this.paper]);
    this.stepFbo = [];
    for (let mobileIndex = 0; mobileIndex < 2; mobileIndex += 1) {
      for (let depositIndex = 0; depositIndex < 2; depositIndex += 1) {
        this.stepFbo[mobileIndex * 2 + depositIndex] = createFramebuffer(gl, [
          this.mobile[mobileIndex],
          this.deposit[depositIndex]
        ]);
      }
    }
    this.readFbo = gl.createFramebuffer();
  }

  createExportTarget() {
    const gl = this.gl;
    this.exportTexture = createTexture(
      gl,
      this.width,
      this.height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      gl.NEAREST
    );
    this.exportFbo = createFramebuffer(gl, [this.exportTexture]);
    this.exportCanvas = document.createElement("canvas");
    this.exportCanvas.width = this.width;
    this.exportCanvas.height = this.height;
    this.exportContext = this.exportCanvas.getContext("2d", { alpha: false });
  }

  resizeCanvas() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  reset() {
    const gl = this.gl;
    this.mobileIndex = 0;
    this.depositIndex = 0;
    for (const framebuffer of [
      this.mobileFbo[0],
      this.mobileFbo[1],
      this.depositFbo[0],
      this.depositFbo[1],
      this.faceHFbo,
      this.faceVFbo
    ]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.statsReads = 0;
    this.present();
  }

  generatePaper() {
    const gl = this.gl;
    const program = this.programs.paper;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paperFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    gl.uniform2f(this.uniforms.paper.uSize, this.width, this.height);
    gl.uniform1f(this.uniforms.paper.uAngle, this.fiberAngle);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  setFiber(angleDegrees, anisotropy, { regenerate = false } = {}) {
    this.fiberAngle = (angleDegrees * Math.PI) / 180;
    this.fiberAnisotropy = anisotropy;
    if (regenerate) this.generatePaper();
  }

  setPresentation({ zoom, panX, panY, showFibers } = {}) {
    if (Number.isFinite(zoom)) this.zoom = zoom;
    if (Number.isFinite(panX)) this.panX = panX;
    if (Number.isFinite(panY)) this.panY = panY;
    if (typeof showFibers === "boolean") this.showFibers = showFibers;
  }

  clampPan() {
    const margin = Math.max(0, 0.5 - 0.5 / this.zoom);
    this.panX = Math.max(-margin, Math.min(margin, this.panX));
    this.panY = Math.max(-margin, Math.min(margin, this.panY));
  }

  copyState(sourceMobile, sourceDeposit, targetMobile, targetDeposit) {
    const gl = this.gl;
    const blit = (sourceFbo, targetFbo) => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targetFbo);
      gl.blitFramebuffer(
        0, 0, this.width, this.height,
        0, 0, this.width, this.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
    };
    blit(this.mobileFbo[sourceMobile], this.mobileFbo[targetMobile]);
    blit(this.depositFbo[sourceDeposit], this.depositFbo[targetDeposit]);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  paint(segments) {
    if (!segments.length) return;
    const gl = this.gl;
    const sourceIndex = this.mobileIndex;
    const targetIndex = 1 - sourceIndex;
    const sourceDepositIndex = this.depositIndex;
    const targetDepositIndex = 1 - sourceDepositIndex;
    const count = segments.length;
    const segmentData = new Float32Array(count * 4);
    const brushData = new Float32Array(count * 4);
    const colorData = new Float32Array(count * 3);

    segments.forEach((segment, index) => {
      segmentData.set(
        [segment.start[0], segment.start[1], segment.end[0], segment.end[1]],
        index * 4
      );
      brushData.set(
        [
          Math.max(0.75, segment.radius),
          segment.mode === "water" ? 1 : 0,
          segment.pigment ?? 0,
          segment.water ?? 0
        ],
        index * 4
      );
      colorData.set(segment.color ?? [0, 0, 0], index * 3);
    });

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const upload = (data, location, size) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(location, 1);
      return buffer;
    };
    const segmentBuffer = upload(segmentData, 1, 4);
    const brushBuffer = upload(brushData, 2, 4);
    const colorBuffer = upload(colorData, 3, 3);

    this.copyState(sourceIndex, sourceDepositIndex, targetIndex, targetDepositIndex);
    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      this.stepFbo[targetIndex * 2 + targetDepositIndex]
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.programs.brush);
    gl.uniform2f(this.uniforms.brush.uSize, this.width, this.height);
    gl.uniform1i(this.uniforms.brush.uMobile, bindTexture(gl, 0, this.mobile[sourceIndex]));
    gl.uniform1i(
      this.uniforms.brush.uDeposit,
      bindTexture(gl, 1, this.deposit[sourceDepositIndex])
    );
    gl.uniform1i(this.uniforms.brush.uPaper, bindTexture(gl, 2, this.paper));
    gl.disable(gl.BLEND);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

    gl.bindVertexArray(null);
    gl.deleteBuffer(segmentBuffer);
    gl.deleteBuffer(brushBuffer);
    gl.deleteBuffer(colorBuffer);
    gl.deleteVertexArray(vao);
    this.mobileIndex = targetIndex;
    this.depositIndex = targetDepositIndex;
  }

  step(count = 1) {
    if (count <= 0) return;
    const gl = this.gl;
    gl.disable(gl.BLEND);
    for (let iteration = 0; iteration < count; iteration += 1) {
      for (let substep = 0; substep < this.substeps; substep += 1) {
        this.computeFaces();
        this.integrateAndDeposit();
      }
    }
  }

  computeFaces() {
    const gl = this.gl;
    const program = this.programs.flux;
    const uniforms = this.uniforms.flux;
    gl.useProgram(program);
    gl.bindVertexArray(this.quadVao);
    gl.uniform2f(uniforms.uSize, this.width, this.height);
    gl.uniform1f(uniforms.uAnisotropy, this.fiberAnisotropy);
    gl.uniform1f(uniforms.uPigmentMobility, this.pigmentMobility);
    gl.uniform1f(uniforms.uWaterMobility, this.waterMobility);
    gl.uniform1i(uniforms.uMobile, bindTexture(gl, 0, this.mobile[this.mobileIndex]));
    gl.uniform1i(uniforms.uPaper, bindTexture(gl, 1, this.paper));

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.faceHFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.uniform2f(uniforms.uDir, 1, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.faceVFbo);
    gl.uniform2f(uniforms.uDir, 0, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  integrateAndDeposit() {
    const gl = this.gl;
    const sourceMobile = this.mobileIndex;
    const sourceDeposit = this.depositIndex;
    const targetMobile = 1 - sourceMobile;
    const targetDeposit = 1 - sourceDeposit;
    const program = this.programs.integrate;
    const uniforms = this.uniforms.integrate;

    gl.useProgram(program);
    gl.bindVertexArray(this.quadVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stepFbo[targetMobile * 2 + targetDeposit]);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.width, this.height);
    gl.uniform2f(uniforms.uSize, this.width, this.height);
    gl.uniform1f(uniforms.uEvaporation, this.evaporation / this.substeps);
    gl.uniform1f(uniforms.uDepositRate, this.depositRate / this.substeps);
    gl.uniform1f(uniforms.uLiftRate, this.liftRate / this.substeps);
    gl.uniform1i(uniforms.uMobile, bindTexture(gl, 0, this.mobile[sourceMobile]));
    gl.uniform1i(uniforms.uDeposit, bindTexture(gl, 1, this.deposit[sourceDeposit]));
    gl.uniform1i(uniforms.uFaceH, bindTexture(gl, 2, this.faceH));
    gl.uniform1i(uniforms.uFaceV, bindTexture(gl, 3, this.faceV));
    gl.uniform1i(uniforms.uPaper, bindTexture(gl, 4, this.paper));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.mobileIndex = targetMobile;
    this.depositIndex = targetDeposit;
  }

  present() {
    const gl = this.gl;
    this.resizeCanvas();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.drawPresent(this.canvas.width, this.canvas.height, this.zoom, this.panX, this.panY);
  }

  drawPresent(viewportWidth, viewportHeight, zoom, panX, panY) {
    const gl = this.gl;
    const program = this.programs.present;
    const uniforms = this.uniforms.present;
    gl.useProgram(program);
    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.BLEND);
    gl.uniform1i(uniforms.uMobile, bindTexture(gl, 0, this.mobile[this.mobileIndex]));
    gl.uniform1i(uniforms.uDeposit, bindTexture(gl, 1, this.deposit[this.depositIndex]));
    gl.uniform1i(uniforms.uPaper, bindTexture(gl, 2, this.paper));
    gl.uniform2f(uniforms.uViewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.uSimSize, this.width, this.height);
    gl.uniform2f(uniforms.uPan, panX, panY);
    gl.uniform1f(uniforms.uZoom, zoom);
    gl.uniform1f(uniforms.uShowFibers, this.showFibers ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  captureFrame() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exportFbo);
    gl.viewport(0, 0, this.width, this.height);
    this.drawPresent(this.width, this.height, 1, 0, 0);
    const pixels = new Uint8Array(this.width * this.height * 4);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = this.width * 4;
    for (let row = 0; row < this.height; row += 1) {
      const source = row * rowBytes;
      const target = (this.height - 1 - row) * rowBytes;
      flipped.set(pixels.subarray(source, source + rowBytes), target);
    }
    const image = new ImageData(flipped, this.width, this.height);
    this.exportContext.putImageData(image, 0, 0);
    return this.exportCanvas.toDataURL("image/png");
  }

  sampleStats() {
    const gl = this.gl;
    const mobile = readFloatTexture(
      gl,
      this.readFbo,
      this.mobile[this.mobileIndex],
      0,
      0,
      this.width,
      this.height
    );
    const deposit = readFloatTexture(
      gl,
      this.readFbo,
      this.deposit[this.depositIndex],
      0,
      0,
      this.width,
      this.height
    );
    let mobileMass = 0;
    let depositMass = 0;
    let waterMass = 0;
    for (let index = 0; index < mobile.length; index += 4) {
      mobileMass += mobile[index] + mobile[index + 1] + mobile[index + 2];
      waterMass += mobile[index + 3];
      depositMass += deposit[index] + deposit[index + 1] + deposit[index + 2];
    }
    this.statsReads += 1;
    return {
      mobile: mobileMass,
      deposit: depositMass,
      water: waterMass,
      total: mobileMass + depositMass
    };
  }

  sampleMobileRegion(x, y, width, height) {
    const gl = this.gl;
    const sampleX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const sampleY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const sampleW = Math.max(1, Math.min(this.width - sampleX, Math.round(width)));
    const sampleH = Math.max(1, Math.min(this.height - sampleY, Math.round(height)));
    const data = readFloatTexture(
      gl,
      this.readFbo,
      this.mobile[this.mobileIndex],
      sampleX,
      sampleY,
      sampleW,
      sampleH
    );
    const result = { r: 0, g: 0, b: 0, water: 0, mass: 0 };
    const divisor = sampleW * sampleH;
    for (let index = 0; index < data.length; index += 4) {
      result.r += data[index];
      result.g += data[index + 1];
      result.b += data[index + 2];
      result.water += data[index + 3];
      result.mass += data[index] + data[index + 1] + data[index + 2];
    }
    result.r /= divisor;
    result.g /= divisor;
    result.b /= divisor;
    result.water /= divisor;
    result.mass /= divisor;
    return result;
  }

  sampleMobilePoint(x, y, radius = 2) {
    return this.sampleMobileRegion(x - radius, y - radius, radius * 2 + 1, radius * 2 + 1);
  }

  readBoundaryFlux() {
    const gl = this.gl;
    const verticalEdge = readFloatTexture(
      gl,
      this.readFbo,
      this.faceH,
      this.width - 1,
      0,
      1,
      this.height
    );
    const horizontalEdge = readFloatTexture(
      gl,
      this.readFbo,
      this.faceV,
      0,
      this.height - 1,
      this.width,
      1
    );
    let total = 0;
    for (const value of verticalEdge) total += Math.abs(value);
    for (const value of horizontalEdge) total += Math.abs(value);
    return total;
  }

  clientToSimulation(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (clientX - rect.left) / rect.width;
    const screenY = 1 - (clientY - rect.top) / rect.height;
    const simX = ((screenX - 0.5) / this.zoom + 0.5 + this.panX) * this.width;
    const simY = ((screenY - 0.5) / this.zoom + 0.5 + this.panY) * this.height;
    return {
      x: simX,
      y: simY,
      inside: simX >= 0 && simY >= 0 && simX <= this.width && simY <= this.height
    };
  }
}
