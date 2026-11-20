// Self-contained WebGL LOD viewer: no external libraries or network access.
const VS = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uMVP;
varying vec3 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = aColor;
}`;
const FS = `
precision mediump float;
varying vec3 vColor;
uniform float uAlpha;
void main() { gl_FragColor = vec4(vColor, uAlpha); }`;

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, center, up) {
  let z = norm3(sub3(eye, center));
  let x = norm3(cross3(up, z));
  let y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1]);
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const PALETTE = [[0.83, 0.32, 0.27], [0.25, 0.45, 0.78], [0.35, 0.7, 0.45],
  [0.85, 0.65, 0.25], [0.6, 0.4, 0.75]];

function parseOBJ(text) {
  const v = [], vt = [], idx = [], uvIdx = [], matIds = [];
  const matMap = new Map();
  let mat = 0;
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "v") v.push(t.slice(1).map(Number));
    else if (t[0] === "vt") vt.push(t.slice(1, 3).map(Number));
    else if (t[0] === "usemtl") {
      const name = t[1];
      if (!matMap.has(name)) matMap.set(name, matMap.size);
      mat = matMap.get(name);
    } else if (t[0] === "f") {
      const tri = [], uvi = [];
      for (let k = 1; k <= 3; k++) {
        const p = t[k].split("/");
        tri.push(parseInt(p[0], 10) - 1);
        uvi.push(p[1] ? parseInt(p[1], 10) - 1 : -1);
      }
      idx.push(tri); uvIdx.push(uvi); matIds.push(mat);
    }
  }
  return { v, idx, matIds, matCount: Math.max(1, matMap.size) };
}

// welded position -> compact index, returning render-ready arrays
function buildArrays(obj) {
  const weld = new Map();
  const positions = [], colors = [], tris = [];
  const key = p => p.map(x => Math.round(x * 1e6)).join(",");
  for (const tri of obj.idx) {
    const out = [];
    for (const vi of tri) {
      const k = key(obj.v[vi]);
      let ci = weld.get(k);
      if (ci === undefined) {
        ci = positions.length / 3;
        weld.set(k, ci);
        positions.push(...obj.v[vi]);
        colors.push(0, 0, 0);
      }
      out.push(ci);
    }
    tris.push(out);
  }
  return { positions, colors, tris, matIds: obj.matIds,
    matCount: obj.matCount };
}

const state = {
  gl: null, mesh: null, wire: false, showConstraints: true,
  yaw: 0.6, pitch: 0.35, dist: 0, center: [0, 0, 0], extent: 1,
  constraints: null,
};

function computeConstraints(mesh) {
  // boundary edges (single incident face) and material hard edges
  const edgeFaces = new Map();
  mesh.tris.forEach((tri, fi) => {
    for (let s = 0; s < 3; s++) {
      const a = tri[s], b = tri[(s + 1) % 3];
      const k = a < b ? a + "_" + b : b + "_" + a;
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k).push(fi);
    }
  });
  const boundary = [], hard = [];
  for (const [k, faces] of edgeFaces) {
    const [a, b] = k.split("_").map(Number);
    if (faces.length === 1) boundary.push(a, b);
    else if (mesh.matIds[faces[0]] !== mesh.matIds[faces[1]])
      hard.push(a, b);
  }
  return { boundary, hard };
}

function colorize(mesh) {
  const n = mesh.positions.length / 3;
  const base = new Float32Array(n * 3);
  for (let fi = 0; fi < mesh.tris.length; fi++) {
    const c = PALETTE[mesh.matIds[fi] % PALETTE.length];
    for (const vi of mesh.tris[fi])
      base.set(c, vi * 3);
  }
  mesh.baseColors = base;
}

function uploadMesh(mesh) {
  const gl = state.gl;
  colorize(mesh);
  mesh.posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions),
    gl.STATIC_DRAW);
  mesh.colorBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.baseColors, gl.DYNAMIC_DRAW);
  // one index buffer with all triangles
  const flat = mesh.tris.flat();
  mesh.indexBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(flat),
    gl.STATIC_DRAW);
  mesh.indexCount = flat.length;
  state.constraints = computeConstraints(mesh);
  const xs = mesh.positions.filter((_, i) => i % 3 === 0);
  const ys = mesh.positions.filter((_, i) => i % 3 === 1);
  const zs = mesh.positions.filter((_, i) => i % 3 === 2);
  state.center = [(Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2];
  state.extent = Math.max(Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs));
  state.dist = state.extent * 2.2;
}

function makeLineBuffer(indices, color) {
  const gl = state.gl, mesh = state.mesh, data = [];
  for (const vi of indices) {
    data.push(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1],
      mesh.positions[vi * 3 + 2], ...color);
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buf, count: indices.length };
}

function drawLines(lines, mvp, loc) {
  const gl = state.gl, prog = state.program;
  if (!lines || lines.count === 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, lines.buf);
  gl.enableVertexAttribArray(loc.aPos);
  gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(loc.aColor);
  gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 24, 12);
  gl.uniformMatrix4fv(loc.uMVP, false, mvp);
  gl.uniform1f(loc.uAlpha, 1.0);
  gl.drawArrays(gl.LINES, 0, lines.count);
}

function render() {
  const gl = state.gl, mesh = state.mesh;
  if (!mesh) return;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.07, 0.08, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const cy = Math.cos(state.pitch), sy = Math.sin(state.pitch);
  const eye = [
    state.center[0] + state.dist * cy * Math.sin(state.yaw),
    state.center[1] + state.dist * sy,
    state.center[2] + state.dist * cy * Math.cos(state.yaw)];
  const proj = perspective(Math.PI / 4, gl.canvas.width / gl.canvas.height,
    0.05, state.extent * 20);
  const view = lookAt(eye, state.center, [0, 0, 1]);
  const mvp = mat4Mul(proj, view);
  const loc = state.loc;
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
  gl.enableVertexAttribArray(loc.aPos);
  gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuf);
  gl.enableVertexAttribArray(loc.aColor);
  gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuf);
  gl.uniformMatrix4fv(loc.uMVP, false, mvp);
  gl.enable(gl.DEPTH_TEST);
  if (state.wire) {
    gl.uniform1f(loc.uAlpha, 0.18);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
    gl.uniform1f(loc.uAlpha, 1.0);
    gl.drawElements(gl.LINES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  } else {
    gl.uniform1f(loc.uAlpha, 1.0);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }
  if (state.showConstraints) {
    gl.disable(gl.DEPTH_TEST);
    drawLines(state.hardLines, mvp, loc);
    drawLines(state.boundaryLines, mvp, loc);
    gl.enable(gl.DEPTH_TEST);
  }
  requestAnimationFrame(render);
}

async function loadModel(url) {
  let text;
  try {
    text = await (await fetch(url)).text();
  } catch (err) {
    // file:// documents block fetch(); fall back to synchronous XHR
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status !== 0 && xhr.status !== 200) throw err;
    text = xhr.responseText;
  }
  const obj = parseOBJ(text);
  const mesh = buildArrays(obj);
  uploadMesh(mesh);
  state.mesh = mesh;
  state.hardLines = makeLineBuffer(state.constraints.hard, [1, 0.9, 0.2]);
  state.boundaryLines = makeLineBuffer(state.constraints.boundary,
    [0.3, 0.9, 1.0]);
  document.getElementById("stats").textContent =
    `${mesh.tris.length} triangles, ${mesh.positions.length / 3} verts, ` +
    `${obj.matCount} materials`;
}

async function init() {
  const canvas = document.getElementById("gl");
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) { document.body.innerHTML = "WebGL unavailable"; return; }
  const ext = gl.getExtension("OES_element_index_uint");
  if (!ext) { document.body.innerHTML = "uint32 indices unsupported"; return; }
  state.gl = gl;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  state.program = prog;
  state.loc = {
    aPos: gl.getAttribLocation(prog, "aPos"),
    aColor: gl.getAttribLocation(prog, "aColor"),
    uMVP: gl.getUniformLocation(prog, "uMVP"),
    uAlpha: gl.getUniformLocation(prog, "uAlpha"),
  };
  // mouse orbit + wheel zoom
  let drag = false, lx = 0, ly = 0;
  canvas.addEventListener("mousedown", e => { drag = true; lx = e.clientX;
    ly = e.clientY; });
  window.addEventListener("mouseup", () => drag = false);
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    state.yaw += (e.clientX - lx) * 0.01;
    state.pitch = Math.max(-1.4, Math.min(1.4,
      state.pitch + (ly - e.clientY) * 0.01));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    state.dist *= 1 + Math.sign(e.deltaY) * 0.08;
  }, { passive: false });
  document.getElementById("wire").onchange = e =>
    state.wire = e.target.checked;
  document.getElementById("cons").onchange = e =>
    state.showConstraints = e.target.checked;
  const sel = document.getElementById("lod");
  sel.onchange = () => loadModel(sel.value);
  await loadModel(sel.value);
  render();
}
window.addEventListener("DOMContentLoaded", () => {
  // wait until the level dropdown is populated by index.html
  const tryStart = setInterval(() => {
    if (document.getElementById("lod").options.length > 0) {
      clearInterval(tryStart);
      init();
    }
  }, 30);
});
