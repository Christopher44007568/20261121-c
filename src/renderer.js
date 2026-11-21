import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  normalize,
  sub
} from "./math.js";

const vertexSource = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
in float aAO;
in float aPart;
in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vAO;
out float vPart;
out vec3 vColor;
void main() {
  vWorld = aPosition;
  vNormal = aNormal;
  vUv = aUv;
  vAO = aAO;
  vPart = aPart;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uLightmap;
uniform int uMode;
uniform vec3 uCamera;
uniform vec3 uLight;
uniform float uAOStrength;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vAO;
in float vPart;
in vec3 vColor;
out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  float ao = uMode == 0 ? vAO : texture(uLightmap, vec3(vUv, floor(vPart + 0.5))).r;
  ao = clamp(ao, 0.0, 1.0);
  float shade = mix(1.0, ao, uAOStrength);
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uCamera - vWorld);
  vec3 keyDir = normalize(uLight);
  vec3 fillDir = normalize(vec3(-0.65, 0.28, -0.52));
  float key = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  float occlusion = mix(1.0, pow(shade, 1.08), 0.92);
  vec3 color = vColor * (0.36 + key * 0.54 + fill * 0.13);
  color *= occlusion;
  color += vec3(0.12, 0.19, 0.20) * (1.0 - shade) * 0.24;
  color += vec3(0.16, 0.19, 0.18) * rim * 0.16;
  outColor = vec4(pow(aces(color * 1.16), vec3(1.0 / 2.2)), 1.0);
}`;

const gridVertex = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uViewProj;
out float vFade;
void main() {
  vFade = clamp(1.0 - length(aPosition.xz) / 13.0, 0.0, 1.0);
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const gridFragment = `#version 300 es
precision highp float;
in float vFade;
out vec4 outColor;
void main() {
  outColor = vec4(0.15, 0.24, 0.25, vFade * 0.42);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
  }
  return shader;
}

function program(gl, vertex, fragment) {
  const result = gl.createProgram();
  gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(result) || "Program link failed");
  }
  return result;
}

function makeGrid() {
  const vertices = [];
  const extent = 12;
  const step = 0.5;
  for (let i = -extent; i <= extent; i += step) {
    vertices.push(i, -0.006, -extent, i, -0.006, extent);
    vertices.push(-extent, -0.006, i, extent, -0.006, i);
  }
  return new Float32Array(vertices);
}

export class ViewportRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    if (!this.gl) throw new Error("WebGL2 unavailable");
    this.main = program(this.gl, vertexSource, fragmentSource);
    this.gridProgram = program(this.gl, gridVertex, gridFragment);
    this.locations = {
      position: this.gl.getAttribLocation(this.main, "aPosition"),
      normal: this.gl.getAttribLocation(this.main, "aNormal"),
      uv: this.gl.getAttribLocation(this.main, "aUv"),
      ao: this.gl.getAttribLocation(this.main, "aAO"),
      part: this.gl.getAttribLocation(this.main, "aPart"),
      color: this.gl.getAttribLocation(this.main, "aColor"),
      viewProj: this.gl.getUniformLocation(this.main, "uViewProj"),
      lightmap: this.gl.getUniformLocation(this.main, "uLightmap"),
      mode: this.gl.getUniformLocation(this.main, "uMode"),
      camera: this.gl.getUniformLocation(this.main, "uCamera"),
      light: this.gl.getUniformLocation(this.main, "uLight"),
      aoStrength: this.gl.getUniformLocation(this.main, "uAOStrength")
    };
    this.gridLocations = {
      position: this.gl.getAttribLocation(this.gridProgram, "aPosition"),
      viewProj: this.gl.getUniformLocation(this.gridProgram, "uViewProj")
    };
    this.scene = null;
    this.result = null;
    this.mode = "vertex";
    this.showGrid = true;
    this.aoStrength = 1;
    this.light = normalize([0.55, 0.9, 0.35]);
    this.camera = { eye: [5, 3, 6], target: [0, 0.7, 0], fov: 34 };
    this.orbit = { yaw: 0, pitch: 0.4, distance: 8 };
    this.gridBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gridBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, makeGrid(), this.gl.STATIC_DRAW);
    this.texture = null;
    this.vertexData = null;
    this.attachPointerControls();
  }

  attribute(vao, location, data, size, dynamic = false) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  setScene(scene) {
    const gl = this.gl;
    this.scene = scene;
    this.result = null;
    this.mode = "vertex";
    this.light = normalize(scene.light || [0.55, 0.9, 0.35]);
    this.camera = {
      eye: [...scene.camera.eye],
      target: [...scene.camera.target],
      fov: scene.camera.fov || 34
    };
    const offset = sub(this.camera.eye, this.camera.target);
    const distance = Math.hypot(...offset);
    this.orbit = {
      distance,
      yaw: Math.atan2(offset[0], offset[2]),
      pitch: Math.asin(offset[1] / distance)
    };
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = null;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.aoBuffer) gl.deleteBuffer(this.aoBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    this.vao = gl.createVertexArray();
    this.meshBuffers = [
      this.attribute(this.vao, this.locations.position, scene.mesh.positions, 3),
      this.attribute(this.vao, this.locations.normal, scene.mesh.normals, 3),
      this.attribute(this.vao, this.locations.uv, scene.mesh.uvs, 2),
      this.attribute(this.vao, this.locations.part, scene.mesh.partIds, 1)
    ];
    const colors = new Float32Array(scene.mesh.positions.length);
    for (let i = 0; i < scene.mesh.partIds.length; i++) {
      const color = scene.parts[scene.mesh.partIds[i]]?.color || [0.78, 0.8, 0.77];
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }
    this.meshBuffers.push(this.attribute(this.vao, this.locations.color, colors, 3));
    const initialAO = new Float32Array(scene.mesh.positions.length / 3).fill(1);
    this.aoBuffer = this.attribute(this.vao, this.locations.ao, initialAO, 1, true);
    this.indexBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.gridVao = gl.createVertexArray();
    this.attribute(this.gridVao, this.gridLocations.position, makeGrid(), 3);
    this.requestRender();
  }

  setBakeResult(result) {
    const gl = this.gl;
    this.result = result;
    this.mode = result.mode;
    if (result.mode === "vertex") {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.aoBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, result.ao);
    } else {
      const layerCount = result.layers.length;
      const bytes = new Uint8Array(result.size * result.size * layerCount * 4);
      let cursor = 0;
      for (const layer of result.layers) {
        for (let i = 0; i < layer.data.length; i++) {
          const value = Math.round(Math.max(0, Math.min(1, layer.data[i])) * 255);
          bytes[cursor++] = value;
          bytes[cursor++] = value;
          bytes[cursor++] = value;
          bytes[cursor++] = 255;
        }
      }
      if (this.texture) gl.deleteTexture(this.texture);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8,
        result.size, result.size, layerCount, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, bytes
      );
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.requestRender();
  }

  setGrid(visible) {
    this.showGrid = visible;
    this.requestRender();
  }

  resize() {
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * Math.min(2, window.devicePixelRatio || 1)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  matrices() {
    const aspect = this.canvas.width / this.canvas.height;
    const target = this.camera.target;
    const cp = Math.cos(this.orbit.pitch);
    const eye = [
      target[0] + this.orbit.distance * cp * Math.sin(this.orbit.yaw),
      target[1] + this.orbit.distance * Math.sin(this.orbit.pitch),
      target[2] + this.orbit.distance * cp * Math.cos(this.orbit.yaw)
    ];
    const view = mat4LookAt(eye, target);
    const projection = mat4Perspective((this.camera.fov * Math.PI) / 180, aspect, 0.03, 80);
    return { eye, viewProj: mat4Multiply(projection, view) };
  }

  render() {
    const gl = this.gl;
    if (!this.scene || !this.vao) return;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.027, 0.041, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const { eye, viewProj } = this.matrices();
    if (this.showGrid) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.gridProgram);
      gl.uniformMatrix4fv(this.gridLocations.viewProj, false, viewProj);
      gl.bindVertexArray(this.gridVao);
      gl.drawArrays(gl.LINES, 0, makeGrid().length / 3);
      gl.disable(gl.BLEND);
    }
    gl.useProgram(this.main);
    gl.uniformMatrix4fv(this.locations.viewProj, false, viewProj);
    gl.uniform3fv(this.locations.camera, eye);
    gl.uniform3fv(this.locations.light, this.light);
    gl.uniform1i(this.locations.mode, this.mode === "lightmap" ? 1 : 0);
    gl.uniform1f(this.locations.aoStrength, this.aoStrength);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture || this.emptyTexture());
    gl.uniform1i(this.locations.lightmap, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.scene.mesh.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  emptyTexture() {
    const gl = this.gl;
    if (!this._emptyTexture) {
      this._emptyTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._emptyTexture);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    return this._emptyTexture;
  }

  project(point) {
    const m = this.matrices().viewProj;
    const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
    const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
    const z = m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14];
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    const visible = w > 0 && z / w > -1 && z / w < 1;
    return {
      x: (x / w * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (0.5 - y / w * 0.5) * this.canvas.clientHeight,
      visible
    };
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
      if (this.onRender) this.onRender();
    });
  }

  attachPointerControls() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add("dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.orbit.yaw -= dx * 0.0075;
      this.orbit.pitch = Math.max(0.03, Math.min(1.48, this.orbit.pitch + dy * 0.006));
      this.requestRender();
    });
    const release = (event) => {
      dragging = false;
      this.canvas.classList.remove("dragging");
      if (event.pointerId != null && this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.orbit.distance = Math.max(2.1, Math.min(22, this.orbit.distance * Math.exp(event.deltaY * 0.0008)));
      this.requestRender();
    }, { passive: false });
    this.canvas.addEventListener("dblclick", () => {
      const offset = sub(this.camera.eye, this.camera.target);
      const distance = Math.hypot(...offset);
      this.orbit = {
        distance,
        yaw: Math.atan2(offset[0], offset[2]),
        pitch: Math.asin(offset[1] / distance)
      };
      this.requestRender();
    });
  }

  screenshot() {
    this.render();
    return this.canvas.toDataURL("image/png");
  }
}
