import { vec3 } from "./math.js";

const DEFAULT_RIGHT = [1, 0, 0];
const DEFAULT_UP = [0, 1, 0];
const DEFAULT_FORWARD = [0, 0, 1];

const BOX_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

const BOX_FACES = [
  { indices: [0, 2, 6, 4], normal: [-1, 0, 0] },
  { indices: [1, 5, 7, 3], normal: [1, 0, 0] },
  { indices: [0, 4, 5, 1], normal: [0, -1, 0] },
  { indices: [2, 3, 7, 6], normal: [0, 1, 0] },
  { indices: [0, 1, 3, 2], normal: [0, 0, -1] },
  { indices: [4, 6, 7, 5], normal: [0, 0, 1] }
];

export function createSolid() {
  return {
    parts: [],
    triangles: [],
    edges: [],
    bounds: {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity]
    }
  };
}

export function beginPart(solid, name, color, metadata = {}) {
  const part = {
    name,
    color: color.slice(),
    metadata: { ...metadata },
    vertices: [],
    triangleStart: solid.triangles.length,
    triangleCount: 0
  };
  solid.parts.push(part);
  return part;
}

export function addBox(solid, part, options) {
  const center = options.center;
  const size = options.size;
  const right = vec3.normalize(options.right || DEFAULT_RIGHT);
  const up = vec3.normalize(options.up || DEFAULT_UP);
  const forward = vec3.normalize(options.forward || DEFAULT_FORWARD);
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  const corners = [];

  for (let index = 0; index < 8; index += 1) {
    const sx = index & 1 ? 1 : -1;
    const sy = index & 2 ? 1 : -1;
    const sz = index & 4 ? 1 : -1;
    corners.push([
      center[0] + right[0] * half[0] * sx + up[0] * half[1] * sy + forward[0] * half[2] * sz,
      center[1] + right[1] * half[0] * sx + up[1] * half[1] * sy + forward[1] * half[2] * sz,
      center[2] + right[2] * half[0] * sx + up[2] * half[1] * sy + forward[2] * half[2] * sz
    ]);
  }

  for (const face of BOX_FACES) {
    const normal = vec3.normalize([
      right[0] * face.normal[0] + up[0] * face.normal[1] + forward[0] * face.normal[2],
      right[1] * face.normal[0] + up[1] * face.normal[1] + forward[1] * face.normal[2],
      right[2] * face.normal[0] + up[2] * face.normal[1] + forward[2] * face.normal[2]
    ]);
    addQuad(solid, part, corners[face.indices[0]], corners[face.indices[1]], corners[face.indices[2]], corners[face.indices[3]], normal);
  }

  for (const [a, b] of BOX_EDGES) {
    const start = corners[a];
    const end = corners[b];
    const back = Boolean(options.thin && a < 4 && b < 4);
    solid.edges.push({
      a: start,
      b: end,
      part: part.name,
      kind: options.kind || "box",
      thinBack: back,
      metadata: { ...part.metadata, ...options.metadata }
    });
  }

  for (const corner of corners) expandBounds(solid.bounds, corner);
  return corners;
}

function addQuad(solid, part, a, b, c, d, normal) {
  addTriangle(solid, part, a, b, c, normal);
  addTriangle(solid, part, a, c, d, normal);
}

function addTriangle(solid, part, a, b, c, normal) {
  solid.triangles.push({ a, b, c, part: part.name });
  part.triangleCount += 1;
  for (const point of [a, b, c]) {
    part.vertices.push(
      point[0], point[1], point[2],
      normal[0], normal[1], normal[2]
    );
  }
  expandBounds(solid.bounds, a);
  expandBounds(solid.bounds, b);
  expandBounds(solid.bounds, c);
}

export function addCoplanarGrid(solid, options) {
  const {
    origin,
    u,
    v,
    divisionsU,
    divisionsV,
    part = "flush-grid",
    kind = "coplanar",
    metadata = {}
  } = options;

  for (let index = 1; index < divisionsU; index += 1) {
    const t = index / divisionsU;
    const start = [
      origin[0] + u[0] * t,
      origin[1] + u[1] * t,
      origin[2] + u[2] * t
    ];
    solid.edges.push({
      a: start,
      b: vec3.add(start, v),
      part,
      kind,
      thinBack: false,
      metadata: { ...metadata, coplanar: true }
    });
  }

  for (let index = 1; index < divisionsV; index += 1) {
    const t = index / divisionsV;
    const start = [
      origin[0] + v[0] * t,
      origin[1] + v[1] * t,
      origin[2] + v[2] * t
    ];
    solid.edges.push({
      a: start,
      b: vec3.add(start, u),
      part,
      kind,
      thinBack: false,
      metadata: { ...metadata, coplanar: true }
    });
  }
}

export function addFrame(solid, options) {
  const {
    part,
    center,
    right,
    up,
    forward,
    width,
    height,
    bar,
    depth,
    metadata = {}
  } = options;
  const horizontalCenter = height / 2 - bar / 2;
  const verticalCenter = width / 2 - bar / 2;

  addBox(solid, part, {
    center: vec3.add(center, vec3.scale(up, horizontalCenter)),
    size: [width, bar, depth],
    right,
    up,
    forward,
    metadata
  });
  addBox(solid, part, {
    center: vec3.add(center, vec3.scale(up, -horizontalCenter)),
    size: [width, bar, depth],
    right,
    up,
    forward,
    metadata
  });
  addBox(solid, part, {
    center: vec3.add(center, vec3.scale(right, verticalCenter)),
    size: [bar, height - bar * 2, depth],
    right,
    up,
    forward,
    metadata
  });
  addBox(solid, part, {
    center: vec3.add(center, vec3.scale(right, -verticalCenter)),
    size: [bar, height - bar * 2, depth],
    right,
    up,
    forward,
    metadata
  });
}

export function expandBounds(bounds, point) {
  bounds.min[0] = Math.min(bounds.min[0], point[0]);
  bounds.min[1] = Math.min(bounds.min[1], point[1]);
  bounds.min[2] = Math.min(bounds.min[2], point[2]);
  bounds.max[0] = Math.max(bounds.max[0], point[0]);
  bounds.max[1] = Math.max(bounds.max[1], point[1]);
  bounds.max[2] = Math.max(bounds.max[2], point[2]);
}

export function interpolateEdge(edge, t) {
  return [
    edge.a[0] + (edge.b[0] - edge.a[0]) * t,
    edge.a[1] + (edge.b[1] - edge.a[1]) * t,
    edge.a[2] + (edge.b[2] - edge.a[2]) * t
  ];
}

export function edgeMidpoint(edge) {
  return interpolateEdge(edge, 0.5);
}
