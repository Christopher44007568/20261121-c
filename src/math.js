export const V3 = {
  add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  length(a) {
    return Math.hypot(a[0], a[1], a[2]);
  },
  normalize(a) {
    const length = V3.length(a) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
  },
  lerp(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  },
};

export const M4 = {
  identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0,
    ]);
  },

  lookAt(eye, target, up) {
    const z = V3.normalize(V3.sub(eye, target));
    const x = V3.normalize(V3.cross(up, z));
    const y = V3.cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1,
    ]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  },
};

export function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / clipW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / clipW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / clipW,
    clipW,
  ];
}

export function projectionMatrix(camera, aspect) {
  return M4.multiply(
    M4.perspective((camera.fov * Math.PI) / 180, aspect, camera.near, camera.far),
    M4.lookAt(camera.eye, camera.target, [0, 1, 0]),
  );
}

export function cameraEye(camera) {
  const azimuth = (camera.azimuth * Math.PI) / 180;
  const elevation = (camera.elevation * Math.PI) / 180;
  const planar = Math.cos(elevation) * camera.radius;
  return [
    camera.target[0] + Math.sin(azimuth) * planar,
    camera.target[1] + Math.sin(elevation) * camera.radius,
    camera.target[2] + Math.cos(azimuth) * planar,
  ];
}

export function projectWorld(point, viewProjection, width, height) {
  const clip = transformPoint(viewProjection, point);
  return {
    x: (clip[0] * 0.5 + 0.5) * width,
    y: (1 - (clip[1] * 0.5 + 0.5)) * height,
    z: clip[2],
    w: clip[3],
    visible: clip[3] > 0 && Math.abs(clip[0]) <= clip[3] * 1.08 && Math.abs(clip[1]) <= clip[3] * 1.08,
  };
}

export function rectDistance(a, b) {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(current, target, amount) {
  return current + (target - current) * amount;
}
