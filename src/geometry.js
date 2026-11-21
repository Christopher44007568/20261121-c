import { V3, M4 } from "./math.js";

const BOX_FACES = [
  { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

const BOX_EDGE_PAIRS = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function createBox(center, size) {
  const positions = [];
  const normals = [];
  const indices = [];
  const half = size.map((value) => value / 2);

  for (const face of BOX_FACES) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(
        center[0] + corner[0] * half[0],
        center[1] + corner[1] * half[1],
        center[2] + corner[2] * half[2],
      );
      normals.push(...face.normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const edgeVertices = [];
  const corners = [];
  for (const z of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const x of [-1, 1]) {
        corners.push([
          center[0] + x * half[0],
          center[1] + y * half[1],
          center[2] + z * half[2],
        ]);
      }
    }
  }
  for (const [a, b] of BOX_EDGE_PAIRS) {
    edgeVertices.push(...corners[a], ...corners[b]);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    edgeVertices: new Float32Array(edgeVertices),
  };
}

export function createCylinder(center, radius, height, segments = 44, capColorSide = true) {
  const positions = [];
  const normals = [];
  const indices = [];
  const edgeVertices = [];
  const halfHeight = height / 2;

  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const base = positions.length / 3;
    positions.push(
      center[0] + ca * radius, center[1] - halfHeight, center[2] + sa * radius,
      center[0] + cb * radius, center[1] - halfHeight, center[2] + sb * radius,
      center[0] + cb * radius, center[1] + halfHeight, center[2] + sb * radius,
      center[0] + ca * radius, center[1] + halfHeight, center[2] + sa * radius,
    );
    normals.push(ca, 0, sa, cb, 0, sb, cb, 0, sb, ca, 0, sa);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    edgeVertices.push(
      center[0] + ca * radius, center[1] - halfHeight, center[2] + sa * radius,
      center[0] + ca * radius, center[1] + halfHeight, center[2] + sa * radius,
    );
  }

  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    positions.push(center[0], center[1] + side * halfHeight, center[2]);
    normals.push(0, side, 0);
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(
        center[0] + Math.cos(angle) * radius,
        center[1] + side * halfHeight,
        center[2] + Math.sin(angle) * radius,
      );
      normals.push(0, side, 0);
      edgeVertices.push(
        center[0] + Math.cos(angle) * radius,
        center[1] + side * halfHeight,
        center[2] + Math.sin(angle) * radius,
        center[0] + Math.cos(((i + 1) / segments) * Math.PI * 2) * radius,
        center[1] + side * halfHeight,
        center[2] + Math.sin(((i + 1) / segments) * Math.PI * 2) * radius,
      );
    }
    for (let i = 1; i < segments; i += 1) {
      indices.push(base, base + i, base + i + 1);
    }
    indices.push(base, base + segments, base + 1);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    edgeVertices: new Float32Array(edgeVertices),
    capColorSide,
  };
}

export function createRod(start, end, radius, segments = 24) {
  const direction = V3.normalize(V3.sub(end, start));
  const helper = Math.abs(direction[1]) > 0.88 ? [1, 0, 0] : [0, 1, 0];
  const tangent = V3.normalize(V3.cross(direction, helper));
  const bitangent = V3.normalize(V3.cross(direction, tangent));
  const positions = [];
  const normals = [];
  const indices = [];
  const edgeVertices = [];

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const ringNormal = V3.add(
      V3.scale(tangent, Math.cos(angle)),
      V3.scale(bitangent, Math.sin(angle)),
    );
    positions.push(...V3.add(start, V3.scale(ringNormal, radius)));
    normals.push(...ringNormal);
  }
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const ringNormal = V3.add(
      V3.scale(tangent, Math.cos(angle)),
      V3.scale(bitangent, Math.sin(angle)),
    );
    positions.push(...V3.add(end, V3.scale(ringNormal, radius)));
    normals.push(...ringNormal);
  }
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(i, segments + i, segments + next, i, segments + next, next);
    edgeVertices.push(...positions.slice(i * 3, i * 3 + 3), ...positions.slice(next * 3, next * 3 + 3));
  }

  const startCenter = positions.length / 3;
  positions.push(...start);
  normals.push(...V3.scale(direction, -1));
  for (let i = 0; i < segments; i += 1) indices.push(startCenter, (i + 1) % segments, i);
  const endCenter = positions.length / 3;
  positions.push(...end);
  normals.push(...direction);
  for (let i = 0; i < segments; i += 1) indices.push(endCenter, segments + i, segments + ((i + 1) % segments));

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    edgeVertices: new Float32Array(edgeVertices),
  };
}

export function createGround(size = 140, segments = 70) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      positions.push((x / segments - 0.5) * size, 0, (z / segments - 0.5) * size);
      normals.push(0, 1, 0);
    }
  }
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const i = z * (segments + 1) + x;
      indices.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    edgeVertices: new Float32Array([]),
  };
}

export function buildScene() {
  const bracketColor = [0.29, 0.38, 0.44];
  const bracketEdge = [0.17, 0.24, 0.29];
  const rotorColor = [0.69, 0.43, 0.16];
  const rotorEdge = [0.37, 0.23, 0.09];
  const dark = [0.18, 0.23, 0.27];

  const bracket = [
    { mesh: createBox([-6.4, 1.9, 0.2], [10.4, 3.8, 8.0]), color: bracketColor, edge: bracketEdge },
    { mesh: createBox([-6.4, 4.35, 0.2], [8.8, 1.1, 6.6]), color: [0.32, 0.41, 0.47], edge: bracketEdge },
    { mesh: createBox([-6.4, 4.92, 0.2], [7.4, 0.16, 5.5]), color: [0.36, 0.45, 0.51], edge: bracketEdge },
    { mesh: createCylinder([-4.8, 5.78, -0.7], 2.15, 1.55, 48), color: [0.38, 0.47, 0.53], edge: bracketEdge },
    { mesh: createCylinder([-4.8, 6.72, -0.7], 1.34, 0.34, 40), color: [0.45, 0.54, 0.59], edge: bracketEdge },
    { mesh: createCylinder([-4.8, 6.92, -0.7], 1.03, 0.06, 40), color: dark, edge: dark },
  ];

  const rotor = [
    { mesh: createBox([5.0, 1.4, -0.2], [9.2, 2.8, 7.4]), color: rotorColor, edge: rotorEdge },
    { mesh: createCylinder([5.0, 3.05, -0.2], 3.12, 0.5, 52), color: [0.75, 0.49, 0.21], edge: rotorEdge },
    { mesh: createCylinder([5.0, 5.0, -0.2], 2.78, 3.4, 56), color: [0.72, 0.46, 0.18], edge: rotorEdge },
    { mesh: createCylinder([5.0, 6.85, -0.2], 1.2, 0.7, 40), color: [0.78, 0.52, 0.24], edge: rotorEdge },
    { mesh: createCylinder([5.0, 7.26, -0.2], 0.78, 0.12, 32), color: [0.58, 0.36, 0.12], edge: rotorEdge },
    { mesh: createRod([5.0, 7.1, -0.1], [8.35, 9.35, 1.25], 0.34, 28), color: [0.66, 0.4, 0.14], edge: rotorEdge },
    { mesh: createCylinder([8.45, 9.48, 1.32], 0.48, 0.74, 28), color: [0.72, 0.46, 0.18], edge: rotorEdge },
  ];

  return {
    camera: {
      azimuth: 36,
      elevation: 22,
      radius: 34,
      target: [0.2, 2.8, -0.4],
      fov: 32,
      near: 0.1,
      far: 180,
    },
    parts: { bracket, rotor },
    ground: createGround(),
    measurements: [
      {
        id: "M1",
        label: "M1",
        name: "总跨距",
        parts: "BRACKET-01 ↔ ROTOR-02",
        a: [-7.6, 5.9, -2.0],
        b: [5.470577645995606, 6.3, 3.0],
        labelSlot: 0,
      },
      {
        id: "M2",
        label: "M2",
        name: "配合间隙",
        parts: "BRACKET-01 ↔ ROTOR-02",
        a: [-1.2, 2.2, -1.5],
        b: [0.6, 2.2, -1.5],
        labelSlot: 1,
      },
    ],
  };
}

export function meshTriangles(scene) {
  return [
    ...Object.values(scene.parts).flat(),
  ];
}
