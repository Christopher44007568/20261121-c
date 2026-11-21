import { TREE } from "./scene.js";

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const VS_COMMON = `#version 300 es
precision highp float;
uniform mat4 uVP;
`;

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.999, 1.0); }
`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
out vec4 frag;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
void main(){
  vec3 horizon = vec3(0.62, 0.55, 0.42);
  vec3 zenith  = vec3(0.16, 0.20, 0.15);
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.85, 1.0 - vUv.y));
  float n = h21(floor(gl_FragCoord.xy / 3.0));
  col += (n - 0.5) * 0.012;
  frag = vec4(col, 1.0);
}
`;

const TERRAIN_VS = VS_COMMON + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
out vec3 vNormal;
out vec3 vWorld;
void main(){
  vNormal = aNormal;
  vWorld = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uCam;
out vec4 frag;
void main(){
  vec3 sun = normalize(vec3(-0.45, 0.8, 0.35));
  float ndl = clamp(dot(normalize(vNormal), sun), 0.0, 1.0);
  vec3 grass = mix(vec3(0.20, 0.24, 0.13), vec3(0.32, 0.34, 0.19),
                   smoothstep(-12.0, 14.0, vWorld.y));
  float shade = 0.42 + 0.58 * ndl;
  vec3 col = grass * shade;
  float fog = smoothstep(60.0, 190.0, distance(vWorld.xz, uCam.xz));
  col = mix(col, vec3(0.55, 0.58, 0.52), fog * 0.75);
  frag = vec4(col, 1.0);
}
`;

// Near-field instanced tree mesh (trunk + tiered cones).
const MESH_VS = VS_COMMON + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aMat;
layout(location=3) in vec3 iOffset;
layout(location=4) in float iScale;
layout(location=5) in float iYaw;
layout(location=6) in float iFade;
out vec3 vNormal;
out float vMat;
out float vFade;
out vec3 vWorld;
void main(){
  float c = cos(iYaw), s = sin(iYaw);
  vec3 p = aPos * iScale;
  p.xz = mat2(c, -s, s, c) * p.xz;
  p += iOffset;
  vec3 n = aNormal;
  n.xz = mat2(c, -s, s, c) * n.xz;
  vNormal = n; vMat = aMat; vFade = iFade; vWorld = p;
  gl_Position = uVP * vec4(p, 1.0);
}
`;

const DITHER_GLSL = `
// 4x4 ordered dithering: smooth spatial dissolve without per-pixel sparkle.
const float bayer4[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);
float ditherGate(float weight){
  ivec2 c = ivec2(mod(gl_FragCoord.xy, 4.0));
  float threshold = (bayer4[c.y * 4 + c.x] + 0.5) / 16.0;
  return step(threshold, weight);
}
`;

const SILHOUETTE_GLSL = `
float silhouette(vec2 uv){
  float trunk = step(0.46, uv.y) * step(uv.y, 0.62)
              * (1.0 - smoothstep(0.0, 0.05, abs(uv.x - 0.5) * 14.0));
  float crown = 0.0;
  for (int i = 0; i < 4; i++) {
    float t = float(i) / 3.0;
    float bottom = mix(0.28, 0.62, t);
    float top = bottom + 0.34;
    float halfW = mix(0.46, 0.16, t);
    float k = clamp((uv.y - bottom) / (top - bottom), 0.0, 1.0);
    float edge = halfW * (1.0 - k);
    float tier = step(bottom, uv.y) * step(uv.y, top)
               * (1.0 - smoothstep(edge - 0.03, edge + 0.03, abs(uv.x - 0.5)));
    crown = max(crown, tier);
  }
  return max(trunk, crown);
}
`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vMat;
in float vFade;
in vec3 vWorld;
uniform vec3 uCam;
uniform int uCoverage;
out vec4 frag;
${DITHER_GLSL}
void main(){
  if (vFade < 1.0 && ditherGate(vFade) < 0.5) discard;
  if (uCoverage == 1) { frag = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 sun = normalize(vec3(-0.45, 0.8, 0.35));
  float ndl = clamp(dot(normalize(vNormal), sun), 0.0, 1.0);
  vec3 leaf = mix(vec3(0.10, 0.17, 0.09), vec3(0.24, 0.34, 0.16), ndl);
  vec3 bark = mix(vec3(0.12, 0.08, 0.05), vec3(0.28, 0.19, 0.12), ndl);
  vec3 col = mix(bark, leaf, step(0.5, vMat));
  float fog = smoothstep(70.0, 190.0, distance(vWorld.xz, uCam.xz));
  col = mix(col, vec3(0.55, 0.58, 0.52), fog * 0.8);
  frag = vec4(col, 1.0);
}
`;

// Far-field billboard proxy with conifer silhouette in the alpha channel,
// plus a baked ground-shading blob drawn with the same instance stream.
const PROXY_VS = VS_COMMON + `
layout(location=0) in vec3 aCorner;   // xy unit quad, z = part flag
layout(location=3) in vec3 iOffset;
layout(location=4) in float iScale;
layout(location=5) in float iYaw;
layout(location=6) in float iFade;
uniform vec3 uCam;
out vec2 vUv;
out float vPart;
out float vFade;
out vec3 vWorld;
void main(){
  float h = iScale * 10.6;
  float w = iScale * 4.4;
  vec3 world;
  if (aCorner.z > 0.5) {
    // Ground shading blob: compact, lying flat at the tree base.
    vec2 g = aCorner.xy * vec2(w * 0.55, w * 0.32);
    float ang = 0.6;
    vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * g;
    world = iOffset + vec3(r.x, 0.06, r.y);
    vPart = 1.0;
  } else {
    // Screen-right vector so the card always faces the camera plane.
    vec3 fwd = normalize(vec3(uCam.x - iOffset.x, 0.0, uCam.z - iOffset.z));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = vec3(0.0, 1.0, 0.0);
    world = iOffset + right * aCorner.x * w * 0.5 + up * (aCorner.y * 0.5 + 0.5) * h;
    vPart = 0.0;
  }
  vUv = aCorner.xy * 0.5 + 0.5;
  vFade = iFade;
  vWorld = world;
  gl_Position = uVP * vec4(world, 1.0);
}
`;

const PROXY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vPart;
in float vFade;
in vec3 vWorld;
uniform vec3 uCam;
uniform int uCoverage;
out vec4 frag;
${DITHER_GLSL}
${SILHOUETTE_GLSL}
void main(){
  if (vPart > 0.5) {
    if (vFade < 1.0 && ditherGate(vFade) < 0.5) discard;
    vec2 c = (vUv - 0.5) * 2.0;
    float a = exp(-dot(c, c) * 3.6) * 0.34;
    if (uCoverage == 1) discard;
    frag = vec4(0.05, 0.07, 0.04, a);
    return;
  }
  if (vFade < 1.0 && ditherGate(vFade) < 0.5) discard;
  float a = silhouette(vUv);
  if (a < 0.12) discard;
  if (uCoverage == 1) { frag = vec4(0.0, 1.0, 0.0, 1.0); return; }
  float vertical = smoothstep(0.15, 0.95, vUv.y);
  float litSide = 1.0 - 0.28 * smoothstep(0.2, 0.95, (0.5 - vUv.x) * 2.0);
  float shade = 0.62 + 0.5 * vertical;
  shade *= litSide;
  vec3 col = vec3(0.16, 0.27, 0.13) * shade;
  float fog = smoothstep(80.0, 200.0, distance(vWorld.xz, uCam.xz));
  col = mix(col, vec3(0.55, 0.58, 0.52), fog * 0.85);
  frag = vec4(col, a);
}
`;

// Coverage-only shaders: write R for mesh pixels, G for proxy pixels.
const COV_MESH_FS = `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag = vec4(1.0, 0.0, 0.0, 1.0); }
`;

const COV_PROXY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vPart;
out vec4 frag;
${SILHOUETTE_GLSL}
void main(){
  if (vPart > 0.5) discard;
  if (silhouette(vUv) < 0.12) discard;
  frag = vec4(0.0, 1.0, 0.0, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) + "\n" + src);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this._maxInstances = 1024;
    this.progs = {
      sky: program(gl, SKY_VS, SKY_FS),
      terrain: program(gl, TERRAIN_VS, TERRAIN_FS),
      mesh: program(gl, MESH_VS, MESH_FS),
      proxy: program(gl, PROXY_VS, PROXY_FS),
      covMesh: program(gl, MESH_VS, COV_MESH_FS),
      covProxy: program(gl, PROXY_VS, COV_PROXY_FS),
    };
    this._quad = this._makeQuad();
  }

  _makeQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  // Terrain grid with analytic normals from the shared height field.
  buildTerrain(heightFn) {
    const gl = this.gl;
    const nx = 140;
    const nz = 180;
    const x0 = -120, x1 = 120, z0 = -160, z1 = 170;
    const positions = [];
    const indices = [];
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = x0 + ((x1 - x0) * ix) / nx;
        const z = z0 + ((z1 - z0) * iz) / nz;
        positions.push(x, heightFn(x, z), z);
      }
    }
    const at = (ix, iz) => iz * (nx + 1) + ix;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
    const normals = new Float32Array(positions.length);
    const eps = 0.6;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], z = positions[i + 2];
      const hL = heightFn(x - eps, z), hR = heightFn(x + eps, z);
      const hD = heightFn(x, z - eps), hU = heightFn(x, z + eps);
      const n = [hL - hR, 2 * eps, hD - hU];
      const l = Math.hypot(n[0], n[1], n[2]);
      normals[i] = n[0] / l; normals[i + 1] = n[1] / l; normals[i + 2] = n[2] / l;
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this._attrib(0, new Float32Array(positions), 3);
    this._attrib(1, normals, 3);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrain = { vao, count: indices.length };
  }

  // One reusable tree mesh; instances carry transform + fade weight.
  buildTreeMesh() {
    const gl = this.gl;
    const { radialSeg, trunkH, trunkR, tiers, tierH, baseR } = TREE;
    const pos = [], nrm = [], mat = [], idx = [];
    const push = (p, n, m) => {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      mat.push(m);
      return pos.length / 3 - 1;
    };
    // Trunk cylinder (material 0).
    for (let i = 0; i <= radialSeg; i++) {
      const a = (i / radialSeg) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      push([x * trunkR, 0, z * trunkR], [x, 0, z], 0);
      push([x * trunkR, trunkH, z * trunkR], [x, 0, z], 0);
    }
    for (let i = 0; i < radialSeg; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    // Tiered cones (material 1), each overlapping the one below.
    for (let t = 0; t < tiers; t++) {
      const y0 = trunkH + t * tierH * 0.72;
      const r = baseR * (1 - t * 0.2);
      const apex = [0, y0 + tierH * 1.25, 0];
      const baseCenter = [0, y0, 0];
      const ring = [];
      for (let i = 0; i <= radialSeg; i++) {
        const a = (i / radialSeg) * Math.PI * 2;
        const x = Math.cos(a), z = Math.sin(a);
        const n = [x * 0.9, 0.45, z * 0.9];
        const nl = Math.hypot(n[0], n[1], n[2]);
        ring.push(push([x * r, y0, z * r], [n[0] / nl, n[1] / nl, n[2] / nl], 1));
      }
      const apexIdx = push(apex, [0, 1, 0], 1);
      const centerIdx = push(baseCenter, [0, -1, 0], 1);
      for (let i = 0; i < radialSeg; i++) {
        idx.push(ring[i], apexIdx, ring[i + 1]);
        idx.push(ring[i + 1], centerIdx, ring[i]);
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this._attrib(0, new Float32Array(pos), 3);
    this._attrib(1, new Float32Array(nrm), 3);
    this._attrib(2, new Float32Array(mat), 1);
    const instanceVbo = this._createInstanceAttribs();
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.treeMesh = { vao, count: idx.length, instanceVbo };
  }

  // Proxy card + shadow blob share one vertex stream, selected by corner.z.
  buildProxy() {
    const gl = this.gl;
    const crown = [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0];
    const blob = [-0.5, -0.5, 1, 0.5, -0.5, 1, -0.5, 0.5, 1, 0.5, 0.5, 1];
    this._proxyGeo("proxy", crown, [0, 1, 2, 1, 3, 2]);
    this._proxyGeo("blob", blob, [0, 1, 2, 1, 3, 2]);
  }

  _proxyGeo(key, v, idx) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this._attrib(0, new Float32Array(v), 3);
    const instanceVbo = this._createInstanceAttribs();
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this[key] = { vao, count: idx.length, instanceVbo };
  }

  _attrib(loc, data, size) {
    const gl = this.gl;
    const bo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  // Persistent per-instance buffer at locations 3..6 (offset/scale/yaw/fade).
  _createInstanceAttribs() {
    const gl = this.gl;
    const bo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bo);
    gl.bufferData(gl.ARRAY_BUFFER, this._maxInstances * 6 * 4, gl.DYNAMIC_DRAW);
    // Layout per instance: vec3 offset (12B), float scale (4B), yaw (4B), fade (4B).
    const layout = [
      { loc: 3, size: 3, offset: 0 },
      { loc: 4, size: 1, offset: 12 },
      { loc: 5, size: 1, offset: 16 },
      { loc: 6, size: 1, offset: 20 },
    ];
    for (const a of layout) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 24, a.offset);
      gl.vertexAttribDivisor(a.loc, 1);
    }
    return bo;
  }

  _uploadInstances(geom, records, trees) {
    const gl = this.gl;
    const data = new Float32Array(records.length * 6);
    let k = 0;
    for (const rec of records) {
      const t = trees[rec.index];
      data[k++] = t.pos[0];
      data[k++] = t.pos[1];
      data[k++] = t.pos[2];
      data[k++] = t.scale;
      data[k++] = t.yaw;
      data[k++] = rec.fade;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  _use(name) {
    const gl = this.gl;
    gl.useProgram(this.progs[name]);
    return this.uniforms(name);
  }

  uniforms(name) {
    const gl = this.gl;
    const p = this.progs[name];
    return (u) => gl.getUniformLocation(p, u);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this._setupCoverage(w, h);
    return [w, h];
  }

  // Low-resolution silhouette target for same-frame coverage telemetry.
  _setupCoverage(fullW, fullH) {
    const gl = this.gl;
    const scale = 0.25;
    const w = Math.max(2, Math.floor(fullW * scale));
    const h = Math.max(2, Math.floor(fullH * scale));
    if (this.cov && this.cov.w === w && this.cov.h === h) return;
    if (this.cov) {
      gl.deleteTexture(this.cov.tex);
      gl.deleteFramebuffer(this.cov.fbo);
      gl.deleteRenderbuffer(this.cov.depth);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cov = { fbo, tex, depth, w, h, pixels: new Uint8Array(w * h * 4) };
  }

  _drawInstances(name, geom, records, trees, vp, cam, forCoverage) {
    const gl = this.gl;
    if (records.length === 0) return;
    const loc = this._use(name);
    gl.uniformMatrix4fv(loc("uVP"), false, vp);
    gl.uniform3fv(loc("uCam"), cam);
    const covLoc = loc("uCoverage");
    if (covLoc !== null) gl.uniform1i(covLoc, forCoverage ? 1 : 0);
    gl.bindVertexArray(geom.vao);
    this._uploadInstances(geom, records, trees);
    gl.drawElementsInstanced(gl.TRIANGLES, geom.count, gl.UNSIGNED_SHORT, 0, records.length);
    gl.bindVertexArray(null);
  }

  // Split records into mesh-stream and proxy-stream draw lists with fade gates.
  _buildDrawLists(records, mode) {
    const mesh = [];
    const proxy = [];
    for (const rec of records) {
      // Each LOD keeps its own dither weight; sum stays ~1 inside the band.
      const meshFade = rec.weight;
      const proxyFade = 1 - rec.weight;
      if (meshFade > 0.001) mesh.push({ ...rec, fade: meshFade });
      if (proxyFade > 0.001) proxy.push({ ...rec, fade: proxyFade });
    }
    return { mesh, proxy };
  }

  // Same-frame screen coverage: render silhouettes offscreen, read back once.
  measureCoverage(records, trees, vp, cam, mode) {
    const gl = this.gl;
    const { mesh, proxy } = this._buildDrawLists(records, mode);
    const { fbo, w, h, pixels } = this.cov;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // R = mesh silhouette, G = proxy silhouette (both written at full alpha).
    this._drawInstances("covProxy", this.proxy, proxy.map((r) => ({ ...r, fade: 1 })), trees, vp, cam, false);
    this._drawInstances("covMesh", this.treeMesh, mesh.map((r) => ({ ...r, fade: 1 })), trees, vp, cam, true);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let meshPx = 0;
    let proxyPx = 0;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const m = pixels[i] > 127;
      const p = pixels[i + 1] > 127;
      if (m) meshPx++;
      if (p && !m) proxyPx++;
      if (m || p) total++;
    }
    const denom = w * h;
    return {
      total: total / denom,
      mesh: meshPx / denom,
      proxy: (proxyPx) / denom,
      w, h,
    };
  }

  frame(records, trees, vp, cam, mode) {
    const gl = this.gl;
    const [w, h] = [this.canvas.width, this.canvas.height];
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clearColor(0.16, 0.2, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky.
    {
      const loc = this._use("sky");
      gl.uniform2f(loc("uRes"), w, h);
      gl.bindVertexArray(this._quad);
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
    }

    // Terrain.
    {
      const loc = this._use("terrain");
      gl.uniformMatrix4fv(loc("uVP"), false, vp);
      gl.uniform3fv(loc("uCam"), cam);
      gl.bindVertexArray(this.terrain.vao);
      gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    }

    const { mesh, proxy } = this._buildDrawLists(records, mode);

    // Ground shading blobs first (alpha blend), then opaque/dithered crowns.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this._drawInstances("proxy", this.blob, proxy, trees, vp, cam, false);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    this._drawInstances("proxy", this.proxy, proxy, trees, vp, cam, false);
    this._drawInstances("mesh", this.treeMesh, mesh, trees, vp, cam, false);
    gl.bindVertexArray(null);
  }
}
