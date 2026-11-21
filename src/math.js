// Minimal column-major mat4 / vec3 helpers (WebGL convention).

export const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function lookAt(eye, center, up) {
  // OpenGL-style view frame: camera looks down -z, so +z points to the eye.
  const z = vec3.norm(vec3.sub(eye, center));
  const x = vec3.norm(vec3.cross(up, z));
  const y = vec3.cross(z, x);
  const m = new Float32Array(16);
  // Column-major: basis vectors occupy columns, translation in column 3.
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2]; m[3] = 0;
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2]; m[7] = 0;
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2]; m[11] = 0;
  m[12] = -vec3.dot(x, eye);
  m[13] = -vec3.dot(y, eye);
  m[14] = -vec3.dot(z, eye);
  m[15] = 1;
  return m;
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// Project a world point to NDC; returns null behind the camera.
export function projectPoint(mvp, p) {
  // Column-major storage: mvp[col * 4 + row], same convention as GLSL.
  const dot4 = (row) =>
    mvp[row] * p[0] + mvp[row + 4] * p[1] + mvp[row + 8] * p[2] + mvp[row + 12];
  const x = dot4(0);
  const y = dot4(1);
  const z = dot4(2);
  const w = dot4(3);
  if (w <= 0.0001) return null;
  return [x / w, y / w, z / w, w];
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic small hash in [0,1).
export function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}
