export const EPS = 1e-8;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
export const length = (v) => Math.hypot(v[0], v[1], v[2]);
export const normalize = (v) => {
  const n = length(v);
  return n > EPS ? [v[0] / n, v[1] / n, v[2] / n] : [0, 1, 0];
};
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const mix = (a, b, t) => a + (b - a) * t;

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

export function mat4LookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}

export function mat4RotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1
  ]);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function radicalInverseVdC(bits) {
  let x = bits >>> 0;
  x = ((x << 16) | (x >>> 16)) >>> 0;
  x = (((x & 0x55555555) << 1) | ((x & 0xaaaaaaaa) >>> 1)) >>> 0;
  x = (((x & 0x33333333) << 2) | ((x & 0xcccccccc) >>> 2)) >>> 0;
  x = (((x & 0x0f0f0f0f) << 4) | ((x & 0xf0f0f0f0) >>> 4)) >>> 0;
  x = (((x & 0x00ff00ff) << 8) | ((x & 0xff00ff00) >>> 8)) >>> 0;
  return x * 2.3283064365386963e-10;
}

export function hammersley(index, count) {
  return [index / count, radicalInverseVdC(index)];
}

export function buildFrame(normal) {
  const n = normalize(normal);
  const helper = Math.abs(n[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  const tangent = normalize(cross(helper, n));
  const bitangent = cross(n, tangent);
  return [tangent, bitangent, n];
}

export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
