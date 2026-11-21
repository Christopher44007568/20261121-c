export const EPSILON = 1e-9;

export const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return length > EPSILON ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
  },
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
};

export const mat4 = {
  identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) {
          sum += a[k * 4 + row] * b[column * 4 + k];
        }
        out[column * 4 + row] = sum;
      }
    }
    return out;
  },

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  },

  lookAt(eye, target, up) {
    const z = vec3.normalize(vec3.sub(eye, target));
    let x = vec3.cross(up, z);
    if (vec3.length(x) < EPSILON) x = [1, 0, 0];
    x = vec3.normalize(x);
    const y = vec3.cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -vec3.dot(x, eye), -vec3.dot(y, eye), -vec3.dot(z, eye), 1
    ]);
  }
};

export function transformPoint(matrix, point) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
  ];
}

export function transformDirection(matrix, direction) {
  const x = direction[0];
  const y = direction[1];
  const z = direction[2];
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z
  ];
}

export function projectPoint(viewProjection, point) {
  const clip = transformPoint(viewProjection, point);
  const behind = clip[3] <= EPSILON;
  const invW = behind ? 0 : 1 / clip[3];
  return {
    x: clip[0] * invW,
    y: clip[1] * invW,
    z: clip[2] * invW,
    w: clip[3],
    behind
  };
}

export function depthFromPoint(viewProjection, point) {
  const projected = projectPoint(viewProjection, point);
  return projected.behind ? 1 : projected.z * 0.5 + 0.5;
}

export function distanceToDepth(distance, near, far) {
  if (!(distance > 0)) return 1;
  return (far * (distance - near)) / (distance * (far - near));
}

export function depthQuantization(bits = 24) {
  return 1 / (2 ** bits - 1);
}

export function quantizeDepth(depth, bits = 24) {
  const levels = 2 ** bits - 1;
  return Math.round(Math.max(0, Math.min(1, depth)) * levels) / levels;
}

export function projectionOffsetDepth(eyePosition, point, offset, near, far, viewMatrix) {
  const view = transformPoint(viewMatrix, point);
  view[2] += offset;
  if (view[2] > -near) return 0;
  const distance = -view[2];
  return distanceToDepth(distance, near, far);
}

export function offsetFailureDistance(offset, near, far, bits = 24) {
  const resolution = depthQuantization(bits);
  const scale = (far * near) / (far - near);
  const safeOffset = Math.max(offset, 0);
  return Math.sqrt((1.5 * safeOffset * scale) / resolution);
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function formatDistance(value) {
  if (!Number.isFinite(value)) return "未消失";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return `${Math.round(value)}`;
}

export function formatScientific(value) {
  return Number(value).toExponential(1);
}
