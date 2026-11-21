import { add, ecefToEnu, enuToEcef, scale, sub, transform3, transpose3 } from './geo.js';
import { splitEcef } from './precision.js';
import { LINE_FRAGMENT, LINE_VERTEX, MARKER_FRAGMENT, MARKER_VERTEX } from './shaders.js';

const MARKER_DIAMETER = 9.2;
const MARKER_SELECTED_DIAMETER = 15;
const MARKER_COLOR = [0.32, 0.96, 0.64];
const MARKER_SELECTED_COLOR = [1.0, 0.805, 0.36];
const LINE_COLOR = [0.19, 0.47, 0.63];
const CORNERS = [
  [-1, -1], [1, -1], [1, 1],
  [-1, -1], [1, 1], [-1, 1],
];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'shader compilation failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  return program;
}

function makeBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
}

function buildLineGeometry(scene) {
  const vertices = [];
  const pushSegment = (aEcef, bEcef, alpha) => {
    vertices.push({ ecef: aEcef, alpha });
    vertices.push({ ecef: bEcef, alpha });
  };

  for (const site of scene.sites) {
    const toEcef = (local) => {
      const anchorEnu = add(
        site.anchorEnu,
        add(scale(site.basis.east, local[0]), scale(site.basis.north, local[1])),
      );
      return enuToEcef(anchorEnu, scene.anchor.ecef, scene.anchor.basis);
    };

    const drawGrid = (half, step, minorAlpha, majorStep) => {
      for (let value = -half; value <= half + 1e-9; value += step) {
        const major = Math.abs(value / step) % majorStep < 0.5;
        const alpha = major ? Math.min(1, minorAlpha * 1.8) : minorAlpha;
        pushSegment(toEcef([value, -half, 0]), toEcef([value, half, 0]), alpha);
        pushSegment(toEcef([-half, value, 0]), toEcef([half, value, 0]), alpha);
      }
    };

    drawGrid(site.gridHalf, site.gridStep, 0.68, 5);
    drawGrid(8, 1, 0.16, 5);
  }

  const anchor = scene.anchor;
  const cross = (axis, sizeMeters) => {
    const a = scale(axis, -sizeMeters);
    const b = scale(axis, sizeMeters);
    pushSegment(
      enuToEcef(add(a, [0, 0, 0.18]), anchor.ecef, anchor.basis),
      enuToEcef(add(b, [0, 0, 0.18]), anchor.ecef, anchor.basis),
      0.55,
    );
  };
  cross(anchor.basis.east, 2.4);
  cross(anchor.basis.north, 2.4);

  pushSegment(scene.sites[0].ecef, scene.sites[1].ecef, 0.42);
  return vertices;
}

function buildMarkerGeometry(scene) {
  const vertices = [];
  scene.markers.forEach((marker, markerIndex) => {
    const idColor = [(markerIndex + 1) / 255, 0, 0];
    const color = marker.siteId === 'bund' ? MARKER_COLOR : [0.34, 0.94, 0.84];
    for (const corner of CORNERS) {
      vertices.push({
        ecef: marker.ecef,
        anchorEnu: marker.anchorEnu,
        corner,
        size: MARKER_DIAMETER,
        color,
        idColor,
        markerIndex,
      });
    }
  });
  const anchorEnu = [0, 0, 0.18];
  const anchorEcef = enuToEcef(anchorEnu, scene.anchor.ecef, scene.anchor.basis);
  for (const corner of CORNERS) {
    vertices.push({
      ecef: anchorEcef,
      anchorEnu,
      corner,
      size: 6.4,
      color: [1.0, 0.78, 0.3],
      idColor: [0, 0, 0],
      markerIndex: -1,
    });
  }
  return { vertices };
}

export class Renderer {
  constructor(canvas, scene) {
    this.canvas = canvas;
    this.scene = scene;
    this.gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is required for the ECEF precision viewer');
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
    this.gl.disable(this.gl.DITHER);
    this.gl.clearColor(0.012, 0.022, 0.04, 1);
    this.mode = 'rtc';
    this.selectedId = null;
    this.pixelRatio = 1;
    this.width = canvas.width;
    this.height = canvas.height;
    this.initPrograms();
    this.initLines();
    this.initMarkers();
    this.initPickTarget();
  }

  initPrograms() {
    const gl = this.gl;
    this.markerProgram = createProgram(gl, MARKER_VERTEX, MARKER_FRAGMENT);
    this.lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    const names = [
      'uMode', 'uCamHi', 'uCamLo', 'uRot', 'uProjection', 'uViewport',
      'uPixelRatio', 'uGlowPass', 'uPickPass', 'uAlpha',
    ];
    this.markerUniforms = {};
    for (const name of names) this.markerUniforms[name] = gl.getUniformLocation(this.markerProgram, name);
    this.lineUniforms = {};
    for (const name of ['uMode', 'uCamHi', 'uCamLo', 'uRot', 'uProjection', 'uLineColor', 'uLineAlpha']) {
      this.lineUniforms[name] = gl.getUniformLocation(this.lineProgram, name);
    }
  }

  initLines() {
    const gl = this.gl;
    this.lineVertices = buildLineGeometry(this.scene);
    for (const vertex of this.lineVertices) {
      vertex.anchorEnu = ecefToEnu(vertex.ecef, this.scene.anchor.ecef, this.scene.anchor.basis);
    }
    const count = this.lineVertices.length;
    const view = new Float32Array(count * 3);
    const high = new Float32Array(count * 3);
    const low = new Float32Array(count * 3);
    const alpha = new Float32Array(count);
    this.lineVertices.forEach((vertex, index) => {
      const split = splitEcef(vertex.ecef);
      high.set(split.hi, index * 3);
      low.set(split.lo, index * 3);
      alpha[index] = vertex.alpha;
    });
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    this.lineViewBuffer = makeBuffer(gl, gl.ARRAY_BUFFER, view, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.attachStaticVec3(1, high);
    this.attachStaticVec3(2, low);
    makeBuffer(gl, gl.ARRAY_BUFFER, alpha);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  initMarkers() {
    const gl = this.gl;
    const { vertices } = buildMarkerGeometry(this.scene);
    this.markerVertexData = vertices;
    const count = vertices.length;
    const view = new Float32Array(count * 3);
    const high = new Float32Array(count * 3);
    const low = new Float32Array(count * 3);
    const corner = new Float32Array(count * 2);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const idColor = new Float32Array(count * 3);
    vertices.forEach((vertex, index) => {
      const split = splitEcef(vertex.ecef);
      high.set(split.hi, index * 3);
      low.set(split.lo, index * 3);
      corner.set(vertex.corner, index * 2);
      size[index] = vertex.size;
      color.set(vertex.color, index * 3);
      idColor.set(vertex.idColor, index * 3);
    });
    this.markerVao = gl.createVertexArray();
    gl.bindVertexArray(this.markerVao);
    this.markerViewBuffer = makeBuffer(gl, gl.ARRAY_BUFFER, view, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.attachStaticVec3(1, high);
    this.attachStaticVec3(2, low);
    makeBuffer(gl, gl.ARRAY_BUFFER, corner);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    this.markerSizeBuffer = makeBuffer(gl, gl.ARRAY_BUFFER, size, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    this.markerColorBuffer = makeBuffer(gl, gl.ARRAY_BUFFER, color, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);
    makeBuffer(gl, gl.ARRAY_BUFFER, idColor);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.markerCount = count;
  }

  attachStaticVec3(location, data) {
    const gl = this.gl;
    makeBuffer(gl, gl.ARRAY_BUFFER, data);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  resize(cssWidth, cssHeight, pixelRatio) {
    this.pixelRatio = pixelRatio;
    this.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    this.height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.resizePickTarget();
    }
  }

  setMode(mode) {
    this.mode = mode === 'hilo' ? 'hilo' : 'rtc';
  }

  setSelection(id) {
    this.selectedId = id;
    const gl = this.gl;
    const sizes = new Float32Array(this.markerCount);
    const colors = new Float32Array(this.markerCount * 3);
    this.markerVertexData.forEach((vertex, index) => {
      const marker = vertex.markerIndex >= 0 ? this.scene.markers[vertex.markerIndex] : null;
      const selected = marker ? marker.id === id : false;
      sizes[index] = selected ? MARKER_SELECTED_DIAMETER : MARKER_DIAMETER;
      const base = selected ? MARKER_SELECTED_COLOR : vertex.color;
      colors.set(base, index * 3);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerSizeBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizes);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerColorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
  }

  updateViews(camera) {
    const gl = this.gl;
    const markerViews = new Float32Array(this.markerCount * 3);
    this.markerVertexData.forEach((vertex, index) => {
      const view = transform3(camera.view.matrix, sub(vertex.anchorEnu, camera.eye));
      markerViews.set(view, index * 3);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerViewBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, markerViews);

    const lineViews = new Float32Array(this.lineVertices.length * 3);
    this.lineVertices.forEach((vertex, index) => {
      const view = transform3(camera.view.matrix, sub(vertex.anchorEnu, camera.eye));
      lineViews.set(view, index * 3);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineViewBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineViews);
  }

  projectionMatrix(camera) {
    const f = 1 / camera.tanHalf;
    const n = camera.near;
    const far = camera.far;
    return new Float32Array([
      f / camera.aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + n) / (n - far), -1,
      0, 0, (2 * far * n) / (n - far), 0,
    ]);
  }

  commonUniforms(program, uniforms, camera) {
    const gl = this.gl;
    const eye = splitEcef(camera.eyeEcef);
    gl.useProgram(program);
    gl.uniform1i(uniforms.uMode, this.mode === 'hilo' ? 1 : 0);
    gl.uniform3fv(uniforms.uCamHi, eye.hi);
    gl.uniform3fv(uniforms.uCamLo, eye.lo);
    gl.uniformMatrix3fv(uniforms.uRot, false, transpose3(camera.ecefToView));
    gl.uniformMatrix4fv(uniforms.uProjection, false, this.projectionMatrix(camera));
  }

  render(camera) {
    const gl = this.gl;
    if (!this.width || !this.height) return;
    this.updateViews(camera);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.012, 0.022, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    this.commonUniforms(this.lineProgram, this.lineUniforms, camera);
    gl.uniform3fv(this.lineUniforms.uLineColor, LINE_COLOR);
    gl.uniform1f(this.lineUniforms.uLineAlpha, 0.62);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.LINES, 0, this.lineVertices.length);

    this.commonUniforms(this.markerProgram, this.markerUniforms, camera);
    gl.uniform2f(this.markerUniforms.uViewport, this.width, this.height);
    gl.uniform1f(this.markerUniforms.uPixelRatio, this.pixelRatio);
    gl.uniform1f(this.markerUniforms.uPickPass, 0);
    gl.uniform1f(this.markerUniforms.uAlpha, 1);
    gl.bindVertexArray(this.markerVao);

    gl.depthMask(false);
    gl.uniform1f(this.markerUniforms.uGlowPass, 1);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, this.markerCount);

    gl.depthMask(true);
    gl.uniform1f(this.markerUniforms.uGlowPass, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.markerCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  initPickTarget() {
    const gl = this.gl;
    this.pickTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    this.pickDepth = gl.createRenderbuffer();
    this.pickFramebuffer = gl.createFramebuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.pickDepth,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`pick framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resizePickTarget() {
    const gl = this.gl;
    if (!this.pickTexture || !this.width || !this.height) return;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.pickDepth,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`pick framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  renderPickPass(camera) {
    const gl = this.gl;
    this.updateViews(camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.commonUniforms(this.markerProgram, this.markerUniforms, camera);
    gl.uniform2f(this.markerUniforms.uViewport, this.width, this.height);
    gl.uniform1f(this.markerUniforms.uPixelRatio, this.pixelRatio);
    gl.uniform1f(this.markerUniforms.uGlowPass, 0);
    gl.uniform1f(this.markerUniforms.uPickPass, 1);
    gl.uniform1f(this.markerUniforms.uAlpha, 1);
    gl.bindVertexArray(this.markerVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.markerCount);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.012, 0.022, 0.04, 1);
  }

  pickGPU(camera, xCss, yCss) {
    if (xCss < 0 || yCss < 0 || xCss >= this.cssWidth || yCss >= this.cssHeight) return null;
    this.renderPickPass(camera);
    const gl = this.gl;
    const x = Math.floor(xCss * this.pixelRatio);
    const y = Math.floor(yCss * this.pixelRatio);
    const pixel = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.readPixels(x, this.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const id = pixel[0];
    return id > 0 && id <= this.scene.markers.length ? this.scene.markers[id - 1] : null;
  }

}
