export const BOARD_HEIGHT = 2.5;
export const LIGHT_Y = 4.65;

export const DEFAULT_STATE = Object.freeze({
  lightWidth: 2.4,
  lightDepth: 1.45,
  boardGap: 0.24,
  boardOffset: 0.18,
  boardWidth: 2.5,
  sampleRate: 4,
  historyAlpha: 0.12
});

export const PROBE_Z = Object.freeze([0.14, 0.3, 0.46, 0.62, 0.78]);
export const PROBE_COLORS = Object.freeze(["#69d7e8", "#75d9c5", "#a4d98b", "#efc477", "#ff9d68"]);

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const mix = (a, b, t) => a + (b - a) * t;

export const vec = {
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
    const length = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
  }
};

export function lightCenter(state) {
  return [0, LIGHT_Y, -1.2 - state.boardOffset * 0.18];
}

export function boardBounds(state) {
  const halfWidth = state.boardWidth * 0.5;
  const z = state.boardOffset;
  return {
    min: [-halfWidth, state.boardGap, z - 0.075],
    max: [halfWidth, state.boardGap + BOARD_HEIGHT, z + 0.075]
  };
}

export function createCamera({
  yaw = 0.52,
  pitch = 0.3,
  distance = 8.3,
  target = [0, 1.17, 0.16],
  fov = 50,
  aspect = 1
} = {}) {
  const cp = Math.cos(pitch);
  const position = [
    target[0] + Math.sin(yaw) * cp * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * cp * distance
  ];
  const forward = vec.normalize(vec.sub(target, position));
  const right = vec.normalize(vec.cross(forward, [0, 1, 0]));
  const up = vec.cross(right, forward);
  return {
    yaw,
    pitch,
    distance,
    target,
    position,
    forward,
    right,
    up,
    fov,
    aspect,
    tanHalfFov: Math.tan((fov * Math.PI) / 360)
  };
}

export function cameraRay(camera, u, v) {
  const sx = (u * 2 - 1) * camera.tanHalfFov * camera.aspect;
  const sy = (1 - v * 2) * camera.tanHalfFov;
  return vec.normalize(
    vec.add(camera.forward, vec.add(vec.scale(camera.right, sx), vec.scale(camera.up, sy)))
  );
}

export function rayBoxSegment(origin, delta, bounds) {
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(delta[axis]) < 1e-8) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return false;
      continue;
    }
    let t0 = (bounds.min[axis] - origin[axis]) / delta[axis];
    let t1 = (bounds.max[axis] - origin[axis]) / delta[axis];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return false;
  }
  return far > 1e-4 && near < 1 - 1e-4;
}

function radicalInverse(index, base) {
  let reversed = 0;
  let fraction = 1 / base;
  let value = index;
  while (value > 0) {
    reversed += (value % base) * fraction;
    value = Math.floor(value / base);
    fraction /= base;
  }
  return reversed;
}

export function visibilityAt(x, z, state, sampleCount = 96, sequenceOffset = 0) {
  const light = lightCenter(state);
  const bounds = boardBounds(state);
  const halfWidth = state.lightWidth * 0.5;
  const halfDepth = state.lightDepth * 0.5;
  const origin = [x, 0.001, z];
  let visible = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = sample + sequenceOffset + 1;
    const u = radicalInverse(index, 2);
    const v = radicalInverse(index, 3);
    const target = [
      light[0] + (u * 2 - 1) * halfWidth,
      LIGHT_Y,
      light[2] + (v * 2 - 1) * halfDepth
    ];
    if (!rayBoxSegment(origin, vec.sub(target, origin), bounds)) visible += 1;
  }
  return visible / sampleCount;
}

function crossingX(samples, threshold) {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous.value >= threshold && current.value < threshold) {
      const t = (previous.value - threshold) / (previous.value - current.value || 1);
      return mix(previous.x, current.x, t);
    }
  }
  return null;
}

export function measureSlice(state, z, samples = 72, areaSamples = 64) {
  const halfWidth = state.boardWidth * 0.5;
  const start = -halfWidth - Math.max(2.5, state.lightWidth * 1.15 + 1.25);
  const end = -halfWidth + 1.8;
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const x = mix(start, end, index / (samples - 1));
    values.push({ x, value: visibilityAt(x, z, state, areaSamples, index * 3) });
  }

  const minimum = Math.min(...values.map((sample) => sample.value));
  const maximum = Math.max(...values.map((sample) => sample.value));
  const reachable = minimum < 0.16 && maximum > 0.62 && maximum - minimum > 0.35;
  const upper = minimum + 0.95 * (maximum - minimum);
  const lower = minimum + 0.05 * (maximum - minimum);
  const middle = (upper + lower) * 0.5;
  const litEdge = crossingX(values, upper);
  const darkEdge = crossingX(values, lower);
  const halfEdge = crossingX(values, middle);
  if (!reachable || litEdge === null || darkEdge === null || halfEdge === null || darkEdge <= litEdge) {
    return { z, width: null, litEdge, darkEdge, halfEdge, values, minimum, maximum };
  }
  return { z, width: darkEdge - litEdge, litEdge, darkEdge, halfEdge, values, minimum, maximum };
}

export function measurePenumbra(state, { areaSamples = 64, slices = 72 } = {}) {
  return PROBE_Z.map((relativeZ) =>
    measureSlice(state, state.boardOffset + relativeZ, slices, areaSamples)
  );
}

export function measureContactEdge(state, { areaSamples = 80, slices = 96 } = {}) {
  const start = state.boardOffset - 0.18;
  const end = state.boardOffset + Math.max(0.9, state.boardGap * 1.6 + 0.25);
  const values = [];
  for (let index = 0; index < slices; index += 1) {
    const z = mix(start, end, index / (slices - 1));
    values.push({ x: z, value: visibilityAt(0, z, state, areaSamples, index * 2) });
  }
  const litEdge = crossingX(values, 0.95);
  const darkEdge = crossingX(values, 0.05);
  if (litEdge === null || darkEdge === null || darkEdge <= litEdge) {
    return { width: null, litEdge, darkEdge, values };
  }
  return { width: darkEdge - litEdge, litEdge, darkEdge, values };
}
