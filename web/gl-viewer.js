// Minimal WebGL2 viewer: glyph cards floating in 3D at different tilts.
// The fragment shader reconstructs coverage with screen-space derivatives
// (fwidth) so edge transition width stays ~1 physical pixel at any angle.

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat4 uMVP;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = uMVP * vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform int uMode;       // 0 = MSDF, 1 = monochrome SDF
uniform vec4 uColor;
uniform float uPxRange;  // signed distance range in source texture px
out vec4 frag;

float median3(vec3 v) {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

void main() {
  vec4 raw = texture(uTex, vUv);
  float sd;
  if (uMode == 0) {
    sd = median3(raw.rgb);
  } else {
    sd = raw.a;
  }
  // Convert normalized [0,1] distance back to texture-pixel units.
  // msdfgen convention: negative distance lies inside the glyph.
  float d = (sd - 0.5) * uPxRange;
  // Screen-space derivative: at grazing angles fwidth grows, which widens
  // the transition exactly enough to keep ~1 physical-pixel anti-aliasing.
  float w = max(fwidth(d), 1e-5);
  float alpha = clamp(0.5 - d / w, 0.0, 1.0);
  if (alpha < 0.01) discard;
  frag = vec4(uColor.rgb, alpha * uColor.a);
}`;

const PLATE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }`;

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

export function rotateX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotateY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotateZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export class GLViewer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.program = this.#program(VERT, FRAG);
    this.plateProgram = this.#program(VERT, PLATE_FRAG);
    this.quad = this.#quad();
    this.textures = new Map();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.07, 0.08, 0.1, 1);
  }

  #shader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  #program(vsSrc, fsSrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.#shader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, this.#shader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
  }

  #quad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  uploadTexture(id, bake, filter) {
    const gl = this.gl;
    let tex = this.textures.get(id);
    if (!tex) {
      tex = gl.createTexture();
      this.textures.set(id, tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, bake.size, bake.size, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, bake.data
    );
    const min = filter === 'linear' ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (filter !== 'linear') gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  #drawCard(card, viewProj, time) {
    const gl = this.gl;
    const tiltY = card.tiltY + (card.drift ? Math.sin(time * 0.6 + card.phase) * 0.08 : 0);
    const model = mat4Mul(
      translate(card.x, card.y, card.z),
      mat4Mul(rotateY(tiltY), mat4Mul(rotateX(card.tiltX), rotateZ(card.tiltZ)))
    );
    const mvp = mat4Mul(viewProj, model);

    // Backing plate so the card plane orientation is visible in 3D.
    gl.useProgram(this.plateProgram);
    gl.bindVertexArray(this.quad);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.plateProgram, 'uMVP'), false, mvp);
    gl.uniform4fv(gl.getUniformLocation(this.plateProgram, 'uColor'), new Float32Array(card.plate));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Glyph field.
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(card.textureId));
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTex'), 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uMVP'), false, mvp);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), card.mode);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uPxRange'), card.pxRange);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'uColor'), new Float32Array(card.color));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  render(cards, camera) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(gl.canvas.clientWidth * dpr);
    const h = Math.floor(gl.canvas.clientHeight * dpr);
    if (gl.canvas.width !== w || gl.canvas.height !== h) {
      gl.canvas.width = w;
      gl.canvas.height = h;
    }
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = perspective(camera.fovy, aspect, 0.1, 100);
    const view = mat4Mul(
      translate(0, 0, -camera.dist),
      mat4Mul(rotateX(camera.pitch), rotateY(camera.yaw))
    );
    const viewProj = mat4Mul(proj, view);
    for (const card of cards) this.#drawCard(card, viewProj, performance.now() / 1000);
  }
}

// Pointer orbit: drag rotates, wheel zooms.
export function attachOrbit(canvas, camera) {
  let dragging = false;
  let last = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camera.yaw += (e.clientX - last.x) * 0.006;
    camera.pitch += (e.clientY - last.y) * 0.006;
    camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch));
    last = { x: e.clientX, y: e.clientY };
  });
  const end = () => (dragging = false);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.dist = Math.max(6, Math.min(40, camera.dist + e.deltaY * 0.01));
    },
    { passive: false }
  );
}
