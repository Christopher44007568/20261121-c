import { makeBox, makeCylinder, makePlane, makeSphere } from "./geometry.js";

export function combineParts(parts) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.positions.length / 3;
    indexCount += part.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const partIds = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  parts.forEach((part, partIndex) => {
    part.vertexStart = vertexOffset;
    part.indexStart = indexOffset;
    part.partIndex = partIndex;
    positions.set(part.positions, vertexOffset * 3);
    normals.set(part.normals, vertexOffset * 3);
    uvs.set(part.uvs, vertexOffset * 2);
    partIds.fill(partIndex, vertexOffset, vertexOffset + part.positions.length / 3);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexOffset + i] = part.indices[i] + vertexOffset;
    }
    vertexOffset += part.positions.length / 3;
    indexOffset += part.indices.length;
  });
  return { positions, normals, uvs, partIds, indices };
}

const definitions = {
  "sphere-plane": {
    title: "球贴平面",
    subtitle: "接触点与软接触梯度",
    code: "SPHERE / PLANE",
    maxDistance: 2.4,
    camera: { eye: [5.4, 3.35, 6.25], target: [0, 0.78, 0], fov: 33 },
    light: [0.55, 0.9, 0.35]
  },
  "edge-contact": {
    title: "贴边接触",
    subtitle: "悬挑零件与平台边缘",
    code: "EDGE / CONTACT",
    maxDistance: 2.4,
    camera: { eye: [6.1, 4.1, 7.0], target: [0, 0.72, 0], fov: 33 },
    light: [0.5, 0.92, 0.38]
  },
  "stacked-gap": {
    title: "叠层低间隙",
    subtitle: "45 mm 等效间隙",
    code: "STACK / 045MM",
    maxDistance: 1.2,
    camera: { eye: [5.8, 4.3, 6.5], target: [0, 0.55, 0], fov: 35 },
    light: [0.45, 0.9, 0.45]
  }
};

export const SCENE_IDS = Object.keys(definitions);

export function getSceneMeta(id) {
  const def = definitions[id] || definitions["sphere-plane"];
  return {
    id: definitions[id] ? id : "sphere-plane",
    title: def.title,
    subtitle: def.subtitle,
    code: def.code,
    maxDistance: def.maxDistance,
    camera: def.camera,
    light: def.light
  };
}

export function createScene(id) {
  const meta = getSceneMeta(id);
  let parts;
  if (meta.id === "sphere-plane") {
    parts = [
      makePlane("ground", {
        name: "地面",
        width: 8.4,
        depth: 8.4,
        segments: 32,
        color: [0.77, 0.79, 0.75]
      }),
      makeSphere("sphere", {
        name: "球体",
        center: [0, 1.005, 0],
        radius: 1,
        slices: 48,
        stacks: 24,
        color: [0.8, 0.82, 0.81]
      })
    ];
  } else if (meta.id === "edge-contact") {
    parts = [
      makeBox("platform", {
        name: "平台",
        center: [0, 0.25, 0],
        size: [6.8, 0.5, 4.4],
        segments: 10,
        color: [0.77, 0.79, 0.76]
      }),
      makeCylinder("overhang", {
        name: "悬挑圆柱",
        center: [2.08, 1.26, 0.28],
        radius: 0.86,
        height: 1.52,
        segments: 48,
        heightSegments: 6,
        color: [0.8, 0.82, 0.81]
      }),
      makeCylinder("pin", {
        name: "定位柱",
        center: [1.0, 1.02, -1.05],
        radius: 0.38,
        height: 1.04,
        segments: 32,
        heightSegments: 5,
        color: [0.79, 0.81, 0.8]
      })
    ];
  } else {
    parts = [
      makeBox("base", {
        name: "底板",
        center: [0, 0.25, 0],
        size: [4.6, 0.5, 3.4],
        segments: 9,
        color: [0.77, 0.79, 0.76]
      }),
      makeBox("middle", {
        name: "中层板",
        center: [0, 0.625, 0],
        size: [3.85, 0.16, 2.8],
        segments: 8,
        color: [0.79, 0.81, 0.78]
      }),
      makeBox("top", {
        name: "顶层板",
        center: [0, 0.83, 0],
        size: [2.95, 0.16, 2.05],
        segments: 7,
        color: [0.81, 0.83, 0.8]
      })
    ];
  }
  return {
    ...meta,
    parts,
    mesh: combineParts(parts),
    vertexCount: parts.reduce((sum, part) => sum + part.positions.length / 3, 0),
    triangleCount: parts.reduce((sum, part) => sum + part.indices.length / 3, 0)
  };
}

export function serializeScene(id) {
  const scene = createScene(id);
  return {
    id: scene.id,
    title: scene.title,
    parts: scene.parts.map((part) => ({
      id: part.id,
      name: part.name,
      color: part.color,
      convex: part.convex,
      positions: part.positions,
      normals: part.normals,
      uvs: part.uvs,
      indices: part.indices
    }))
  };
}

export function sceneFromSerialized(data) {
  const parts = data.parts.map((part) => ({ ...part }));
  return {
    ...data,
    parts,
    mesh: combineParts(parts),
    vertexCount: parts.reduce((sum, part) => sum + part.positions.length / 3, 0),
    triangleCount: parts.reduce((sum, part) => sum + part.indices.length / 3, 0)
  };
}
