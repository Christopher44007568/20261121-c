export const EPSILON = 1e-7;

export const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (v, s) => vec3(v.x * s, v.y * s, v.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => vec3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
export const length = (v) => Math.hypot(v.x, v.y, v.z);
export const distance = (a, b) => length(sub(a, b));
export const normalize = (v) => {
  const len = length(v);
  return len < EPSILON ? vec3() : scale(v, 1 / len);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function mat4Identity() {
  return new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = value;
    }
  }
  return out;
}

export function mat4Translation(position) {
  const m = mat4Identity();
  m[12] = position.x;
  m[13] = position.y;
  m[14] = position.z;
  return m;
}

export function mat4Rotation(rotation = vec3()) {
  const cx = Math.cos(rotation.x);
  const sx = Math.sin(rotation.x);
  const cy = Math.cos(rotation.y);
  const sy = Math.sin(rotation.y);
  const cz = Math.cos(rotation.z);
  const sz = Math.sin(rotation.z);
  return new Float64Array([
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Compose(position, rotation = vec3()) {
  return mat4Multiply(mat4Translation(position), mat4Rotation(rotation));
}

export function transformPoint(matrix, point) {
  return vec3(
    matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
    matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
    matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
  );
}

export function matrixColumns(matrix) {
  return [
    vec3(matrix[0], matrix[1], matrix[2]),
    vec3(matrix[4], matrix[5], matrix[6]),
    vec3(matrix[8], matrix[9], matrix[10]),
  ];
}

export function matricesEqual(a, b, epsilon = 1e-9) {
  return a.every((value, index) => Math.abs(value - b[index]) <= epsilon);
}

export function convexHull2D(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;
  const turn = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
