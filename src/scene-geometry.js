import {
  add,
  clamp,
  cross,
  distance,
  dot,
  mat4Rotation,
  matrixColumns,
  normalize,
  scale,
  sub,
  vec3,
} from "./geometry.js";

export const AXIS_VECTORS = {
  x: vec3(1, 0, 0),
  y: vec3(0, 1, 0),
  z: vec3(0, 0, 1),
};

export function createCamera(options = {}) {
  return {
    yaw: options.yaw ?? -0.72,
    pitch: options.pitch ?? 0.38,
    distance: options.distance ?? 24,
    target: options.target ?? vec3(0, 0, 0),
    fov: options.fov ?? (42 * Math.PI) / 180,
  };
}

export function cameraEye(camera) {
  const horizontal = Math.cos(camera.pitch) * camera.distance;
  return add(camera.target, vec3(
    Math.sin(camera.yaw) * horizontal,
    Math.sin(camera.pitch) * camera.distance,
    Math.cos(camera.yaw) * horizontal,
  ));
}

export function cameraFrame(camera) {
  const eye = cameraEye(camera);
  const forward = normalize(sub(camera.target, eye));
  const right = normalize(cross(forward, vec3(0, 1, 0)));
  const up = normalize(cross(right, forward));
  return { eye, forward, right, up };
}

export function projectPoint(point, camera, width, height) {
  const { eye, forward, right, up } = cameraFrame(camera);
  const relative = sub(point, eye);
  const depth = dot(relative, forward);
  if (depth <= 0.02) return { x: 0, y: 0, depth, visible: false };
  const focal = height / (2 * Math.tan(camera.fov / 2));
  return {
    x: width / 2 + (dot(relative, right) * focal) / depth,
    y: height / 2 - (dot(relative, up) * focal) / depth,
    depth,
    visible: true,
  };
}

export function makeObb(center, size, rotation = vec3()) {
  const axes = matrixColumns(mat4Rotation(rotation));
  return {
    center,
    axes,
    extents: vec3(size.x / 2, size.y / 2, size.z / 2),
  };
}

export function obbCorners(obb) {
  const { center, axes, extents } = obb;
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(add(center, add(add(
          scale(axes[0], extents.x * sx),
          scale(axes[1], extents.y * sy),
        ), scale(axes[2], extents.z * sz))));
      }
    }
  }
  return corners;
}

export function projectObb(obb, camera, width, height) {
  const points = obbCorners(obb).map((point) =>
    projectPoint(point, camera, width, height));
  return {
    points,
    projectedCenter: projectPoint(obb.center, camera, width, height),
  };
}

export function pointToObbDistance(point, obb) {
  const relative = sub(point, obb.center);
  const local = vec3(
    clamp(dot(relative, obb.axes[0]), -obb.extents.x, obb.extents.x),
    clamp(dot(relative, obb.axes[1]), -obb.extents.y, obb.extents.y),
    clamp(dot(relative, obb.axes[2]), -obb.extents.z, obb.extents.z),
  );
  const closest = add(obb.center, add(add(
    scale(obb.axes[0], local.x),
    scale(obb.axes[1], local.y),
  ), scale(obb.axes[2], local.z)));
  return distance(point, closest);
}

function segmentDistance(a0, a1, b0, b1) {
  const u = sub(a1, a0);
  const v = sub(b1, b0);
  const w = sub(a0, b0);
  const aa = dot(u, u);
  const bb = dot(u, v);
  const cc = dot(v, v);
  const dd = dot(u, w);
  const ee = dot(v, w);
  const denominator = aa * cc - bb * bb;
  let s = 0;
  let t = 0;
  if (denominator > 1e-9) {
    s = clamp((bb * ee - cc * dd) / denominator, 0, 1);
    t = clamp((aa * ee - bb * dd) / denominator, 0, 1);
  } else {
    t = cc > 1e-9 ? clamp(ee / cc, 0, 1) : 0;
  }
  const pa = add(a0, scale(u, s));
  const pb = add(b0, scale(v, t));
  return distance(pa, pb);
}

const EDGE_PAIRS = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function obbDistance(a, b) {
  const aCorners = obbCorners(a);
  const bCorners = obbCorners(b);
  let minimum = Infinity;
  for (const corner of aCorners) minimum = Math.min(minimum, pointToObbDistance(corner, b));
  for (const corner of bCorners) minimum = Math.min(minimum, pointToObbDistance(corner, a));
  for (const [a0, a1] of EDGE_PAIRS) {
    for (const [b0, b1] of EDGE_PAIRS) {
      minimum = Math.min(
        minimum,
        segmentDistance(aCorners[a0], aCorners[a1], bCorners[b0], bCorners[b1]),
      );
    }
  }
  return minimum;
}
