import {
  createCoverageTexture,
  createMesh,
  createRenderTarget,
  createSimpleMesh,
  compileProgram,
  readTarget,
} from "./gl.js";
import { createCoverageMips } from "./coverage.js";
import {
  buildAlphaPlate,
  buildContourLines,
  buildMaskQuad,
  buildScreenGeometry,
  SCREEN,
} from "./plate.js";
import { lookAt, multiply, normalMatrix, perspective, rotationY } from "./math.js";
import {
  coverageFragment,
  materialFragment,
  materialVertex,
} from "./shaders/material.js";
import {
  backgroundFragment,
  backgroundVertex,
  blitFragment,
  blitVertex,
  solidFragment,
  solidVertex,
} from "./shaders/utility.js";

function configureSampler(gl, program, name, unit) {
  gl.useProgram(program);
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1i(location, unit);
}

export class ScreenRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.uniforms = new Map();
    this.targets = new Map();
    this.time = 0;
    this.lastTarget = null;

    this.programs = {
      material: compileProgram(gl, materialVertex, materialFragment, "material"),
      coverage: compileProgram(gl, materialVertex, coverageFragment, "coverage"),
      background: compileProgram(gl, backgroundVertex, backgroundFragment, "background"),
      blit: compileProgram(gl, blitVertex, blitFragment, "blit"),
      solid: compileProgram(gl, solidVertex, solidFragment, "solid"),
    };
    configureSampler(gl, this.programs.material, "uMask", 0);
    configureSampler(gl, this.programs.coverage, "uMask", 0);
    configureSampler(gl, this.programs.blit, "uSource", 1);

    this.alphaMesh = createMesh(gl, buildAlphaPlate(SCREEN));
    this.geometryMesh = createMesh(gl, buildScreenGeometry(SCREEN));
    this.maskMesh = createSimpleMesh(gl, buildMaskQuad(SCREEN));
    this.contourMesh = createSimpleMesh(gl, buildContourLines(SCREEN));
    this.emptyVao = gl.createVertexArray();

    this.mask = createCoverageMips(SCREEN);
    this.maskTexture = createCoverageTexture(gl, this.mask.levels);
    this.info = this.readInfo();

    gl.disable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.01, 0.015, 0.018, 1);
  }

  readInfo() {
    const gl = this.gl;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    return {
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      anisotropy: this.maskTexture?.anisotropy ?? 1,
      gpuTimerAvailable: Boolean(timer),
      timerSource: timer ? "EXT_disjoint_timer_query_webgl2" : "cpu_finish_fallback",
    };
  }

  uniform(program, name) {
    let locations = this.uniforms.get(program);
    if (!locations) {
      locations = new Map();
      this.uniforms.set(program, locations);
    }
    if (!locations.has(name)) {
      locations.set(name, this.gl.getUniformLocation(program, name));
    }
    return locations.get(name);
  }

  setMat4(program, name, value) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.uniform(program, name), false, value);
  }

  setVec2(program, name, x, y) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform2f(this.uniform(program, name), x, y);
  }

  setVec3(program, name, value) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform3fv(this.uniform(program, name), value);
  }

  setFloat(program, name, value) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform1f(this.uniform(program, name), value);
  }

  setInt(program, name, value) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform1i(this.uniform(program, name), value);
  }

  resizeCanvas(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  getTarget(width, height, samples) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const s = Math.max(0, Math.min(samples, this.info.maxSamples));
    const key = `${w}x${h}x${s}`;
    if (!this.targets.has(key)) {
      if (this.targets.size > 10) {
        const [oldKey, old] = this.targets.entries().next().value;
        const gl = this.gl;
        gl.deleteFramebuffer(old.fbo);
        gl.deleteFramebuffer(old.resolveFbo);
        gl.deleteTexture(old.texture);
        if (old.colorBuffer) gl.deleteRenderbuffer(old.colorBuffer);
        if (old.depthBuffer) gl.deleteRenderbuffer(old.depthBuffer);
        this.targets.delete(oldKey);
      }
      this.targets.set(key, createRenderTarget(this.gl, w, h, s));
    }
    return this.targets.get(key);
  }

  camera({ width, height, distance, tiltDegrees = 0, jitter = [0, 0] }) {
    const aspect = width / height;
    const eye = [0, 0, distance];
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const projection = perspective((42 * Math.PI) / 180, aspect, 0.05, 60);
    projection[8] += (2 * jitter[0]) / width;
    projection[9] += (2 * jitter[1]) / height;
    const model = rotationY((tiltDegrees * Math.PI) / 180);
    return {
      eye,
      model,
      normal: normalMatrix(model),
      viewProjection: multiply(projection, view),
    };
  }

  drawFullscreen(program) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  drawBackground(width, height) {
    const gl = this.gl;
    const program = this.programs.background;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.setVec2(program, "uResolution", width, height);
    this.setFloat(program, "uTime", this.time);
    this.drawFullscreen(program);
  }

  prepareMaterial(program, cam, settings) {
    const gl = this.gl;
    this.setMat4(program, "uModel", cam.model);
    this.setMat4(program, "uViewProjection", cam.viewProjection);
    gl.useProgram(program);
    gl.uniformMatrix3fv(this.uniform(program, "uNormalMatrix"), false, cam.normal);
    gl.uniform2f(this.uniform(program, "uJitter"), 0, 0);
    gl.uniform3fv(this.uniform(program, "uCamera"), cam.eye);
    gl.uniform3fv(this.uniform(program, "uTint"), new Float32Array([0.34, 0.45, 0.49]));
    gl.uniform1f(this.uniform(program, "uThreshold"), settings.threshold ?? 0.5);
    gl.uniform1f(this.uniform(program, "uMipBias"), settings.mipBias ?? 0);
    gl.uniform1i(this.uniform(program, "uAlphaMode"), settings.alphaMode ?? 0);
    gl.uniform1f(this.uniform(program, "uDebugHoles"), settings.debugHoles ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture.texture);
  }

  drawPipeline(mesh, settings, target, coverage = false) {
    const gl = this.gl;
    const cam = this.camera({
      width: target.width,
      height: target.height,
      distance: settings.distance,
      tiltDegrees: settings.tiltDegrees,
      jitter: settings.jitter,
    });
    const program = coverage ? this.programs.coverage : this.programs.material;
    this.prepareMaterial(program, cam, settings);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (settings.alphaMode === 2 && target.samples > 1) {
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    } else {
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.bindVertexArray(null);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    return cam;
  }

  drawContours(cam) {
    const gl = this.gl;
    const program = this.programs.solid;
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.uniform(program, "uModel"), false, cam.model);
    gl.uniformMatrix4fv(this.uniform(program, "uViewProjection"), false, cam.viewProjection);
    gl.uniform2f(this.uniform(program, "uJitter"), 0, 0);
    gl.uniform4f(this.uniform(program, "uColor"), 1.0, 0.38, 0.06, 0.64);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.lineWidth(1);
    gl.bindVertexArray(this.contourMesh.vao);
    gl.drawArrays(gl.LINES, 0, this.contourMesh.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }

  render(settings) {
    const gl = this.gl;
    const width = Math.max(1, Math.round(settings.width));
    const height = Math.max(1, Math.round(settings.height));
    const samples = settings.samples ?? 0;
    const target = this.getTarget(width, height, samples);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    gl.clearColor(0.005, 0.008, 0.01, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (settings.showBackground !== false) this.drawBackground(target.width, target.height);

    let cam;
    if (settings.mode === "split") {
      const splitX = Math.round(target.width * (settings.split ?? 0.5));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, Math.max(1, splitX), target.height);
      cam = this.drawPipeline(this.alphaMesh, settings, target);
      gl.scissor(splitX, 0, Math.max(1, target.width - splitX), target.height);
      this.drawPipeline(this.geometryMesh, { ...settings, alphaMode: 0 }, target);
      gl.disable(gl.SCISSOR_TEST);
    } else if (settings.mode === "geometry") {
      cam = this.drawPipeline(this.geometryMesh, { ...settings, alphaMode: 0 }, target);
    } else {
      cam = this.drawPipeline(this.alphaMesh, settings, target);
    }

    if (settings.showContours) this.drawContours(cam);
    target.resolve();
    this.lastTarget = target;
    return target;
  }

  renderCoverage(settings) {
    const gl = this.gl;
    const width = Math.max(1, Math.round(settings.width));
    const height = Math.max(1, Math.round(settings.height));
    const target = this.getTarget(width, height, settings.samples ?? 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (settings.kind === "mask") {
      this.drawMask(settings, target);
    } else {
      const mesh = settings.kind === "geometry" ? this.geometryMesh : this.alphaMesh;
      this.drawPipeline(mesh, settings, target, true);
    }
    target.resolve();
    return target;
  }

  captureCoverage(settings) {
    const target = this.renderCoverage(settings);
    return readTarget(this.gl, target);
  }

  drawMask(settings, target) {
    const gl = this.gl;
    const cam = this.camera({
      width: target.width,
      height: target.height,
      distance: settings.distance,
      tiltDegrees: settings.tiltDegrees,
      jitter: settings.jitter,
    });
    const program = this.programs.solid;
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.uniform(program, "uModel"), false, cam.model);
    gl.uniformMatrix4fv(this.uniform(program, "uViewProjection"), false, cam.viewProjection);
    gl.uniform2f(this.uniform(program, "uJitter"), 0, 0);
    gl.uniform4f(this.uniform(program, "uColor"), 1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(this.maskMesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.maskMesh.count);
    gl.bindVertexArray(null);
  }

  present(target = this.lastTarget) {
    const gl = this.gl;
    if (!target) return;
    target.resolve();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const program = this.programs.blit;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    this.drawFullscreen(program);
  }

  renderAndPresent(settings) {
    const target = this.render(settings);
    this.present(target);
    return target;
  }

  benchmarkOneMSAA(samples, options) {
    const gl = this.gl;
    const {
      width = 640,
      height = 400,
      distance = 3.2,
      tiltDegrees = 30,
      framesPerBatch = 6,
      batches = 5,
    } = options;
    const ext = options.forceCpu ? null : gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const warmup = Math.min(4, framesPerBatch);
    const renderFrame = (index) => {
      const phase = index * 0.37;
      return this.render({
        width,
        height,
        samples,
        mode: "alpha",
        alphaMode: 2,
        threshold: 0.5,
        distance: distance * (1 + Math.sin(phase) * 0.012),
        tiltDegrees: tiltDegrees + Math.cos(phase) * 0.8,
        jitter: [Math.cos(phase) * 0.4, Math.sin(phase) * 0.4],
        showBackground: false,
      });
    };

    for (let i = 0; i < warmup; i += 1) renderFrame(i);
    gl.finish();
    const samplesMs = [];
    let timerSource = ext ? "gpu_timer" : "cpu_finish_fallback";
    const syncPixel = new Uint8Array(4);
    const forceSync = (target) => {
      gl.finish();
      if (!target) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    for (let batch = 0; batch < batches; batch += 1) {
      if (ext) {
        const query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        for (let i = 0; i < framesPerBatch; i += 1) renderFrame(batch * 31 + i);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        gl.finish();
        const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (available && !disjoint) {
          samplesMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / framesPerBatch);
        } else {
          timerSource = "cpu_finish_fallback";
        }
        gl.deleteQuery(query);
      } else {
        gl.finish();
        const start = performance.now();
        let lastTarget = null;
        for (let i = 0; i < framesPerBatch; i += 1) lastTarget = renderFrame(batch * 31 + i);
        forceSync(lastTarget);
        samplesMs.push((performance.now() - start) / framesPerBatch);
      }
    }
    if (ext && samplesMs.length < batches) {
      return this.benchmarkOneMSAA(samples, { ...options, forceCpu: true });
    }
    samplesMs.sort((a, b) => a - b);
    const median = samplesMs.length
      ? samplesMs[Math.floor(samplesMs.length / 2)]
      : Number.NaN;
    const bytesPerPixel = 8;
    return {
      samples,
      width,
      height,
      framesPerBatch,
      batches,
      msMedian: median,
      msMin: samplesMs[0] ?? Number.NaN,
      msMax: samplesMs[samplesMs.length - 1] ?? Number.NaN,
      timerSource,
      effectiveSamples: samples > 1 ? samples : 1,
      estimatedAttachmentBytes:
        width * height * bytesPerPixel * (samples > 1 ? samples : 1),
    };
  }

  benchmarkMSAA(options = {}) {
    const samplesList = options.samplesList ?? [0, 2, 4, 8];
    const results = [];
    for (const samples of samplesList) {
      if (samples > 1 && samples > this.info.maxSamples) continue;
      results.push(this.benchmarkOneMSAA(samples, options));
    }
    const base = results.find((result) => result.samples <= 1)?.msMedian ?? 1;
    for (const result of results) {
      result.relativeTo1x = result.msMedian / base;
    }
    return results;
  }

  benchmarkOneFillMSAA(samples, options) {
    const gl = this.gl;
    const {
      width = 960,
      height = 600,
      framesPerBatch = 20,
      batches = 9,
      passesPerFrame = 12,
    } = options;
    const target = this.getTarget(width, height, samples);
    const syncPixel = new Uint8Array(4);
    const drawFrame = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0.02, 0.03, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (let pass = 0; pass < passesPerFrame; pass += 1) {
        this.drawBackground(target.width, target.height);
      }
      target.resolve();
      return target;
    };
    for (let i = 0; i < framesPerBatch; i += 1) drawFrame();
    gl.finish();
    const runs = [];
    for (let batch = 0; batch < batches; batch += 1) {
      gl.finish();
      const start = performance.now();
      let lastTarget;
      for (let i = 0; i < framesPerBatch; i += 1) lastTarget = drawFrame();
      gl.finish();
      gl.bindFramebuffer(gl.FRAMEBUFFER, lastTarget.resolveFbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      runs.push((performance.now() - start) / framesPerBatch);
    }
    runs.sort((a, b) => a - b);
    return {
      samples,
      width,
      height,
      passesPerFrame,
      framesPerBatch,
      batches,
      msMedian: runs[Math.floor(runs.length / 2)],
      msMin: runs[0],
      msMax: runs[runs.length - 1],
      timerSource: "cpu_finish_fallback",
      effectiveSamples: samples > 1 ? samples : 1,
      estimatedAttachmentBytes:
        width * height * 8 * (samples > 1 ? samples : 1),
    };
  }

  benchmarkMSAAFill(options = {}) {
    const samplesList = options.samplesList ?? [0, 2, 4, 8];
    const results = [];
    for (const samples of samplesList) {
      if (samples > 1 && samples > this.info.maxSamples) continue;
      results.push(this.benchmarkOneFillMSAA(samples, options));
    }
    const baseline = results.find((result) => result.samples <= 1)?.msMedian ?? 1;
    for (const result of results) result.relativeTo1x = result.msMedian / baseline;
    return results;
  }
}
