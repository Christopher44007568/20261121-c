import {
  perspectiveReverseZ,
  lookAt,
  multiply,
  invert,
  projectWorld
} from "./math.js";
import { createGround, createCylinder, createBox } from "./geometry.js";
import {
  fullscreenVS,
  sceneVS,
  sceneFS,
  depthCopyFS,
  depthDownsampleFS
} from "./shaders/scene.js";
import { contactTraceFS } from "./shaders/trace.js";
import { geometryReferenceFS } from "./shaders/reference.js";
import { compositeFS } from "./shaders/composite.js";

const HIZ_LEVELS = 9;
const MAX_TEXEL_MIP = HIZ_LEVELS - 1;
const ROD = { base: [0, 0, 0], radius: 0.058, height: 7.2 };
const WALL_MIN = [-4.2, 0, -3.55];
const WALL_MAX = [5.2, 4.4, -3.31];
const NEAR_PLANE = 0.08;
const FAR_PLANE = 62;
const LIGHT_DIR = [0.52, 0.86, -0.38];

export const SHOTS = {
  near: {
    eye: [1.18, 1.3, 2.32],
    target: [-0.06, 0.6, 0.02],
    fov: 50,
    probe: [-0.087, 0, 0.0076]
  },
  edge: {
    eye: [1.34, 1.25, 1.92],
    target: [0.86, 0.72, 0.02],
    fov: 52,
    probe: [0.6, 0.018, 0.36],
    probeUv: [0.234, 0.761]
  },
  miss: {
    eye: [3.0, 1.86, 4.42],
    target: [0.3, 0.72, -1.18],
    fov: 49,
    probe: [0.72, 0.018, 1.08]
  }
};

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function createColorTexture(gl, width, height, options = {}) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.filter || gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.filter || gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    options.internalFormat || gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    options.type || gl.UNSIGNED_BYTE,
    null
  );
  return texture;
}

function createDepthTexture(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    width,
    height,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null
  );
  return texture;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed:\n${log}\n\n${source}`);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed:\n${gl.getProgramInfoLog(program)}`);
  }
  const uniforms = Object.create(null);
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function setUniform(gl, pass, name, type, value) {
  const location = pass.uniforms[name];
  if (location == null) return;
  if (type === "1i") gl.uniform1i(location, value);
  else if (type === "1f") gl.uniform1f(location, value);
  else if (type === "2f") gl.uniform2f(location, value[0], value[1]);
  else if (type === "3f") gl.uniform3f(location, value[0], value[1], value[2]);
  else if (type === "2i") gl.uniform2i(location, value[0], value[1]);
  else if (type === "mat4") gl.uniformMatrix4fv(location, false, value);
}

export class ContactShadowRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    if (!this.gl) throw new Error("WebGL2 is required for this demo.");
    this.gl.getExtension("EXT_color_buffer_float");
    this.viewMode = 0;
    this.shotName = "near";
    this.rayLength = 0.9;
    this.orbit = false;
    this.orbitAngle = 0;
    this.probeAuto = true;
    this.probeUv = null;
    this.lastProbe = null;
    this.width = 1;
    this.height = 1;

    this.projection = new Float32Array(16);
    this.view = new Float32Array(16);
    this.viewProjection = new Float32Array(16);
    this.invViewProjection = new Float32Array(16);
    this.cameraPosition = [0, 0, 0];
    this.lightDirection = normalize3(LIGHT_DIR);

    this.initPrograms();
    this.initScene();
    this.resize(true);
  }

  initPrograms() {
    const gl = this.gl;
    this.programs = {
      scene: createProgram(gl, sceneVS, sceneFS),
      depthCopy: createProgram(gl, fullscreenVS, depthCopyFS),
      downsample: createProgram(gl, fullscreenVS, depthDownsampleFS),
      trace: createProgram(gl, fullscreenVS, contactTraceFS),
      reference: createProgram(gl, fullscreenVS, geometryReferenceFS),
      composite: createProgram(gl, fullscreenVS, compositeFS)
    };
    this.emptyVao = gl.createVertexArray();
  }

  initScene() {
    this.ground = this.createMesh(createGround(36));
    this.rod = this.createMesh(
      createCylinder(ROD.base, ROD.radius, ROD.height, 32)
    );
    this.wall = this.createMesh(createBox(WALL_MIN, WALL_MAX));
  }

  createMesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    return { vao, buffer, count: data.length / 6 };
  }

  checkFramebuffer(label) {
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`${label} framebuffer incomplete (0x${status.toString(16)})`);
    }
  }

  createTargets(width, height) {
    const gl = this.gl;
    this.destroyTargets();
    this.width = width;
    this.height = height;

    this.albedoTex = createColorTexture(gl, width, height);
    this.normalTex = createColorTexture(gl, width, height);
    this.depthTex = createDepthTexture(gl, width, height);
    this.gbufferFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbufferFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albedoTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.normalTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.checkFramebuffer("G-buffer");

    this.traceTex = createColorTexture(gl, width, height, { filter: gl.LINEAR });
    this.traceFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.traceFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.traceTex, 0);
    this.checkFramebuffer("Trace");

    this.referenceTex = createColorTexture(gl, width, height, { filter: gl.LINEAR });
    this.referenceFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.referenceFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.referenceTex, 0);
    this.checkFramebuffer("Reference");

    this.hizTex = [];
    this.hizSize = [];
    for (let level = 0; level < HIZ_LEVELS; level++) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      this.hizSize.push([w, h]);
      this.hizTex.push(
        createColorTexture(gl, w, h, {
          internalFormat: gl.RGBA16F,
          type: gl.HALF_FLOAT,
          filter: gl.NEAREST
        })
      );
    }
    this.hizFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  destroyTargets() {
    const gl = this.gl;
    for (const key of [
      "albedoTex",
      "normalTex",
      "depthTex",
      "traceTex",
      "referenceTex"
    ]) {
      if (this[key]) gl.deleteTexture(this[key]);
      this[key] = null;
    }
    if (this.hizTex) for (const tex of this.hizTex) gl.deleteTexture(tex);
    for (const key of ["gbufferFbo", "traceFbo", "referenceFbo", "hizFbo"]) {
      if (this[key]) gl.deleteFramebuffer(this[key]);
      this[key] = null;
    }
    this.hizTex = null;
  }

  resize(force = false) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round((rect.width || 1440) * dpr));
    const height = Math.max(1, Math.round((rect.height || 960) * dpr));
    if (!force && width === this.width && height === this.height) return false;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.createTargets(width, height);
    return true;
  }

  updateCamera(time = 0) {
    const shot = SHOTS[this.shotName];
    let eye = shot.eye.slice();
    const target = shot.target;
    if (this.orbit) {
      const yaw = this.orbitAngle + time * 0.00013;
      const dx = eye[0] - target[0];
      const dz = eye[2] - target[2];
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      eye = [
        target[0] + dx * c - dz * s,
        eye[1],
        target[2] + dx * s + dz * c
      ];
    }
    this.cameraPosition = eye;
    lookAt(this.view, eye, target, [0, 1, 0]);
    perspectiveReverseZ(
      this.projection,
      (shot.fov * Math.PI) / 180,
      this.width / this.height,
      NEAR_PLANE,
      FAR_PLANE
    );
    multiply(this.viewProjection, this.projection, this.view);
    invert(this.invViewProjection, this.viewProjection);
  }

  setView(viewMode) {
    this.viewMode = viewMode;
  }

  setShot(name) {
    if (!SHOTS[name]) throw new Error(`Unknown test shot: ${name}`);
    this.shotName = name;
    this.orbitAngle = 0;
    this.probeAuto = true;
    this.probeUv = null;
  }

  setRayLength(value) {
    this.rayLength = Math.min(1.4, Math.max(0.3, value));
  }

  setOrbit(enabled) {
    this.orbit = enabled;
  }

  setUserProbe(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.probeAuto = false;
    this.probeUv = [
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height))
    ];
  }

  resetAutoProbe() {
    this.probeAuto = true;
    this.probeUv = null;
  }

  projectiveProbePixel() {
    if (!this.probeAuto && this.probeUv) {
      return [
        Math.min(this.width - 1, Math.max(0, Math.floor(this.probeUv[0] * this.width))),
        Math.min(this.height - 1, Math.max(0, Math.floor(this.probeUv[1] * this.height)))
      ];
    }
    const fixedUv = SHOTS[this.shotName].probeUv;
    if (fixedUv) {
      return [
        Math.min(this.width - 1, Math.max(0, Math.floor(fixedUv[0] * this.width))),
        Math.min(this.height - 1, Math.max(0, Math.floor(fixedUv[1] * this.height)))
      ];
    }
    const point = SHOTS[this.shotName].probe;
    const projected = projectWorld(
      this.viewProjection,
      point,
      this.width,
      this.height
    );
    if (projected.w <= 0) return [this.width >> 1, this.height >> 1];
    return [
      Math.min(this.width - 1, Math.max(0, Math.floor(projected.x))),
      Math.min(this.height - 1, Math.max(0, Math.floor(projected.y)))
    ];
  }

  render(time = 0) {
    const started = performance.now();
    this.updateCamera(time);
    this.renderGBuffer();
    this.buildDepthPyramid();
    this.traceContacts();
    this.renderReference();
    this.composite();
    this.frameMilliseconds = performance.now() - started;
    this.lastProbe = this.readProbe();
    this.lastProbe.frameMilliseconds = this.frameMilliseconds;
    return this.lastProbe;
  }

  renderGBuffer() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbufferFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.GREATER);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const pass = this.programs.scene;
    gl.useProgram(pass.program);
    setUniform(gl, pass, "uViewProj", "mat4", this.viewProjection);
    const meshes = [
      [this.ground, 0],
      [this.rod, 1],
      [this.wall, 2]
    ];
    for (const [mesh, material] of meshes) {
      setUniform(gl, pass, "uMaterial", "1i", material);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.bindVertexArray(null);
  }

  buildDepthPyramid() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hizFbo);
    gl.activeTexture(gl.TEXTURE0);

    const copy = this.programs.depthCopy;
    gl.useProgram(copy.program);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.hizTex[0],
      0
    );
    gl.viewport(0, 0, this.hizSize[0][0], this.hizSize[0][1]);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    setUniform(gl, copy, "uDepth", "1i", 0);
    this.checkFramebuffer("Hi-Z level 0");
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const down = this.programs.downsample;
    gl.useProgram(down.program);
    for (let level = 1; level < HIZ_LEVELS; level++) {
      const [w, h] = this.hizSize[level];
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.hizTex[level],
        0
      );
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.hizTex[level - 1]);
      setUniform(gl, down, "uSource", "1i", 0);
      setUniform(gl, down, "uSourceSize", "2i", this.hizSize[level - 1]);
      setUniform(gl, down, "uDestSize", "2i", this.hizSize[level]);
      this.checkFramebuffer(`Hi-Z level ${level}`);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  traceContacts() {
    const gl = this.gl;
    const pass = this.programs.trace;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.traceFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    setUniform(gl, pass, "uDepth", "1i", 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.normalTex);
    setUniform(gl, pass, "uNormal", "1i", 1);
    for (let level = 0; level < HIZ_LEVELS; level++) {
      gl.activeTexture(gl.TEXTURE2 + level);
      gl.bindTexture(gl.TEXTURE_2D, this.hizTex[level]);
      setUniform(gl, pass, `uHiZ${level}`, "1i", 2 + level);
    }
    setUniform(gl, pass, "uViewProj", "mat4", this.viewProjection);
    setUniform(gl, pass, "uInvViewProj", "mat4", this.invViewProjection);
    setUniform(gl, pass, "uLightDir", "3f", this.lightDirection);
    setUniform(gl, pass, "uResolution", "2f", [this.width, this.height]);
    setUniform(gl, pass, "uNear", "1f", NEAR_PLANE);
    setUniform(gl, pass, "uFar", "1f", FAR_PLANE);
    setUniform(gl, pass, "uRayLength", "1f", this.rayLength);
    setUniform(gl, pass, "uThickness", "1f", 0.14);
    setUniform(gl, pass, "uDepthBias", "1f", 0.000045);
    setUniform(gl, pass, "uMaxMip", "1i", MAX_TEXEL_MIP);
    this.checkFramebuffer("Contact trace");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderReference() {
    const gl = this.gl;
    const pass = this.programs.reference;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.referenceFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(1, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    setUniform(gl, pass, "uDepth", "1i", 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.normalTex);
    setUniform(gl, pass, "uNormal", "1i", 1);
    setUniform(gl, pass, "uInvViewProj", "mat4", this.invViewProjection);
    setUniform(gl, pass, "uLightDir", "3f", this.lightDirection);
    setUniform(gl, pass, "uResolution", "2f", [this.width, this.height]);
    setUniform(gl, pass, "uRayLength", "1f", this.rayLength);
    setUniform(gl, pass, "uRodBase", "3f", ROD.base);
    setUniform(gl, pass, "uRodRadius", "1f", ROD.radius);
    setUniform(gl, pass, "uRodHeight", "1f", ROD.height);
    setUniform(gl, pass, "uWallMin", "3f", WALL_MIN);
    setUniform(gl, pass, "uWallMax", "3f", WALL_MAX);
    this.checkFramebuffer("Geometry reference");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  composite() {
    const gl = this.gl;
    const pass = this.programs.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pass.program);
    const textures = [
      this.albedoTex,
      this.normalTex,
      this.depthTex,
      this.traceTex,
      this.referenceTex
    ];
    for (let i = 0; i < textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    }
    setUniform(gl, pass, "uAlbedo", "1i", 0);
    setUniform(gl, pass, "uNormal", "1i", 1);
    setUniform(gl, pass, "uDepth", "1i", 2);
    setUniform(gl, pass, "uTrace", "1i", 3);
    setUniform(gl, pass, "uReference", "1i", 4);
    setUniform(gl, pass, "uInvViewProj", "mat4", this.invViewProjection);
    setUniform(gl, pass, "uCameraPos", "3f", this.cameraPosition);
    setUniform(gl, pass, "uLightDir", "3f", this.lightDirection);
    setUniform(gl, pass, "uResolution", "2f", [this.width, this.height]);
    setUniform(gl, pass, "uNear", "1f", NEAR_PLANE);
    setUniform(gl, pass, "uFar", "1f", FAR_PLANE);
    setUniform(gl, pass, "uViewMode", "1i", this.viewMode);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  readProbe() {
    const gl = this.gl;
    const [x, y] = this.projectiveProbePixel();
    const trace = new Uint8Array(4);
    const reference = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.traceFbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, trace);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.referenceFbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, reference);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const steps = Math.round((trace[0] / 255) * 63);
    const packed = trace[1];
    const basis = packed % 8;
    const mip = Math.floor(packed / 8);
    const gap = (trace[2] / 255) * 0.25;
    const refOccluded = reference[3] > 127;
    const basisNames = ["clear", "depth gap", "screen edge", "range end"];
    const basisName = basisNames[basis] || "clear";
    let note;
    if (basis === 1 && refOccluded) {
      note = "Contact confirmed: the screen trace and short 3D reference both find an occluder.";
    } else if (basis === 1 && !refOccluded) {
      note = "False contact: the pyramid reports a depth gap, but the short 3D reference is clear.";
    } else if (basis === 2) {
      note = refOccluded
        ? "Screen edge: the ray leaves the viewport before the reference occluder is reached."
        : "Screen edge: the light ray leaves the viewport, so contact coverage is inconclusive.";
    } else if (basis === 3 && refOccluded) {
      note = "Missed contact: the short reference is occluded but the screen ray reaches its range end.";
    } else if (basis === 3) {
      note = "Clear: both the screen-space ray and the short 3D reference reach the range end.";
    } else {
      note = "No deferred surface at this pixel.";
    }
    return {
      pixel: [x, this.height - 1 - y],
      steps,
      mip,
      basis,
      basisName,
      gap: basis === 1 ? gap : null,
      referenceOccluded: refOccluded,
      referenceKind: reference[1] === 1 ? "rod" : reference[1] === 2 ? "wall" : "clear",
      note,
      auto: this.probeAuto,
      rayLength: this.rayLength,
      shot: this.shotName,
      frameMilliseconds: this.frameMilliseconds || 0
    };
  }

  debugReadDepth(x, y) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hizFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.hizTex[0],
      0
    );
    const out = new Float32Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(out);
  }

  debugReadTraceRect(x, y, width, height) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.traceFbo);
    const out = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(out);
  }
}
