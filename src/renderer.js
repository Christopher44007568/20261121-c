import {
  blitFragmentShader,
  blitVertexShader,
  edgeFragmentShader,
  edgeVertexShader,
  solidFragmentShader,
  solidVertexShader
} from "./shaders.js";

const EDGE_FLOATS_PER_VERTEX = 8;
const EDGE_VERTICES = 6;

export class ViewerRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: false,
      preserveDrawingBuffer: true
    });
    if (!this.gl) throw new Error("WebGL2 不可用");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.edgeCount = 0;
    this.solidProgram = createProgram(this.gl, solidVertexShader, solidFragmentShader);
    this.edgeProgram = createProgram(this.gl, edgeVertexShader, edgeFragmentShader);
    this.blitProgram = createProgram(this.gl, blitVertexShader, blitFragmentShader);
    this.solidUniforms = getUniforms(this.gl, this.solidProgram, [
      "uViewProjection", "uColor", "uCameraPosition"
    ]);
    this.edgeUniforms = getUniforms(this.gl, this.edgeProgram, [
      "uViewProjection", "uViewport", "uPixelWidth", "uOffsetWorld",
      "uNear", "uFar", "uSceneDepth", "uSplitX", "uTolerance", "uDepthLevels",
      "uOffsetColor", "uDepthColor", "uMode"
    ]);
    this.blitUniforms = getUniforms(this.gl, this.blitProgram, ["uColor"]);
    this.blitVao = this.gl.createVertexArray();
    this.edgeVao = this.gl.createVertexArray();
    this.edgeBuffer = this.gl.createBuffer();
    this.resize();
  }

  resize() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (width === this.width && height === this.height && this.framebuffer) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = width;
    this.canvas.height = height;
    this.createFramebuffer();
  }

  createFramebuffer() {
    const gl = this.gl;
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.colorTexture) gl.deleteTexture(this.colorTexture);
    if (this.depthTexture) gl.deleteTexture(this.depthTexture);

    this.framebuffer = gl.createFramebuffer();
    this.colorTexture = createTexture(gl);
    this.depthTexture = createTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.width, this.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`深度帧缓冲创建失败: 0x${status.toString(16)}`);
    }
  }

  setScene(solid) {
    const gl = this.gl;
    for (const part of this.solidParts || []) {
      gl.deleteVertexArray(part.vao);
      gl.deleteBuffer(part.buffer);
    }
    this.solidParts = solid.parts.map((part) => {
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(part.vertices), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      return {
        vao,
        buffer,
        color: part.color,
        vertexCount: part.vertices.length / 6
      };
    });
    gl.bindVertexArray(null);
    this.setEdges(solid.edges);
  }

  setEdges(edges) {
    const gl = this.gl;
    const data = new Float32Array(edges.length * EDGE_VERTICES * EDGE_FLOATS_PER_VERTEX);
    let cursor = 0;
    const corners = [
      [1, 0], [-1, 0], [-1, 1],
      [1, 0], [-1, 1], [1, 1]
    ];
    for (const edge of edges) {
      for (const [side, t] of corners) {
        data[cursor++] = edge.a[0];
        data[cursor++] = edge.a[1];
        data[cursor++] = edge.a[2];
        data[cursor++] = edge.b[0];
        data[cursor++] = edge.b[1];
        data[cursor++] = edge.b[2];
        data[cursor++] = side;
        data[cursor++] = t;
      }
    }
    gl.bindVertexArray(this.edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = EDGE_FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
    gl.bindVertexArray(null);
    this.edgeCount = edges.length;
  }

  render(frame) {
    const gl = this.gl;
    const { viewProjection, eye, offset, tolerance, mode, depthBits, near, far } = frame;
    const modeIndex = mode === "offset" ? 0 : mode === "depth" ? 1 : 2;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.027, 0.055, 0.082, 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.solidProgram);
    gl.uniformMatrix4fv(this.solidUniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(this.solidUniforms.uCameraPosition, eye);
    for (const part of this.solidParts) {
      gl.uniform3fv(this.solidUniforms.uColor, part.color);
      gl.bindVertexArray(part.vao);
      gl.drawArrays(gl.TRIANGLES, 0, part.vertexCount);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.blitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.uniform1i(this.blitUniforms.uColor, 0);
    gl.bindVertexArray(this.blitVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.edgeProgram);
    gl.uniformMatrix4fv(this.edgeUniforms.uViewProjection, false, viewProjection);
    gl.uniform2f(this.edgeUniforms.uViewport, this.width, this.height);
    gl.uniform1f(this.edgeUniforms.uPixelWidth, Math.max(1.5, 1.75 * this.dpr));
    gl.uniform1f(this.edgeUniforms.uOffsetWorld, offset);
    gl.uniform1f(this.edgeUniforms.uNear, near);
    gl.uniform1f(this.edgeUniforms.uFar, far);
    gl.uniform1f(this.edgeUniforms.uSplitX, this.width * 0.5);
    gl.uniform1f(this.edgeUniforms.uTolerance, tolerance);
    gl.uniform1f(this.edgeUniforms.uDepthLevels, 2 ** depthBits - 1);
    gl.uniform3f(this.edgeUniforms.uOffsetColor, 1.0, 0.62, 0.22);
    gl.uniform3f(this.edgeUniforms.uDepthColor, 0.28, 0.86, 0.94);
    gl.uniform1i(this.edgeUniforms.uMode, modeIndex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.uniform1i(this.edgeUniforms.uSceneDepth, 0);
    gl.bindVertexArray(this.edgeVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.edgeCount * EDGE_VERTICES);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  getInfo() {
    const gl = this.gl;
    const renderer = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: renderer ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL) : "WebGL2"
    };
  }
}

function createTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
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
    throw new Error(gl.getProgramInfoLog(program) || "着色器链接失败");
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "着色器编译失败");
  }
  return shader;
}

function getUniforms(gl, program, names) {
  const uniforms = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return uniforms;
}
