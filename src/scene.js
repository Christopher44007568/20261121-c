import { vec3 } from "./math.js";
import { addBox, addCoplanarGrid, addFrame, beginPart, createSolid } from "./geometry.js";

export const VIEW_CONFIG = {
  fovY: Math.PI / 4,
  near: 0.05,
  far: 6000,
  depthBits: 24
};

export const FAR_POSE = {
  id: "far",
  name: "远场门架",
  code: "04",
  eye: [8, 5, 36],
  target: [8, 5, -2000],
  up: [0, 1, 0]
};

export const CAMERA_STATIONS = [
  {
    id: "overview",
    name: "3/4 总览",
    code: "01",
    eye: [9.5, 7.2, 13.2],
    target: [0, 1.9, 0],
    up: [0, 1, 0]
  },
  {
    id: "fin",
    name: "薄片正视",
    code: "02",
    eye: [2.1, 2.2, 7.2],
    target: [2.1, 2.2, 0.15],
    up: [0, 1, 0]
  },
  {
    id: "occluded",
    name: "遮挡视角",
    code: "03",
    eye: [-8.6, 3.9, 8.8],
    target: [-1.9, 1.65, 0.25],
    up: [0, 1, 0]
  },
  FAR_POSE
];

const steel = [0.36, 0.41, 0.47];
const blueSteel = [0.24, 0.37, 0.58];
const copper = [0.61, 0.32, 0.16];
const pale = [0.55, 0.64, 0.72];
const teal = [0.17, 0.44, 0.49];
const gateColor = [0.28, 0.47, 0.54];
const gatePanelColor = [0.12, 0.22, 0.26];

export function buildScene() {
  const solid = createSolid();

  const base = beginPart(solid, "base", steel, { category: "body" });
  addBox(solid, base, { center: [0, 0.35, 0], size: [8.4, 0.7, 5.2] });
  addBox(solid, base, { center: [-3.35, 0.85, 1.65], size: [0.55, 0.3, 0.55] });
  addBox(solid, base, { center: [3.35, 0.85, 1.65], size: [0.55, 0.3, 0.55] });

  const plate = beginPart(solid, "rear-plate", blueSteel, { category: "body" });
  addBox(solid, plate, { center: [-2.05, 2.25, -1.2], size: [3.5, 3.2, 0.32] });

  const occluder = beginPart(solid, "front-block", copper, { category: "occluder" });
  addBox(solid, occluder, { center: [-2.0, 1.55, 1.15], size: [2.7, 1.35, 1.25] });

  const mast = beginPart(solid, "rear-mast", teal, { category: "body" });
  addBox(solid, mast, { center: [0.25, 2.5, -1.55], size: [0.65, 4.2, 0.45] });

  const rail = beginPart(solid, "top-rail", steel, { category: "body" });
  addBox(solid, rail, { center: [0.2, 4.35, -1.55], size: [7.5, 0.32, 0.32] });

  const support = beginPart(solid, "fin-support", steel, { category: "body" });
  addBox(solid, support, { center: [2.1, 0.9, 0.15], size: [0.42, 1.2, 0.42] });

  const fin = beginPart(solid, "thin-fin", pale, { category: "thin-sheet" });
  addBox(solid, fin, {
    center: [2.1, 2.15, 0.15],
    size: [2.65, 2.5, 0.035],
    thin: true
  });

  const clamp = beginPart(solid, "right-clamp", copper, { category: "occluder" });
  addBox(solid, clamp, { center: [3.85, 2.3, 1.05], size: [0.9, 2.5, 1.15] });

  addCoplanarGrid(solid, {
    origin: [1.02, 1.26, 0.1675],
    u: [2.16, 0, 0],
    v: [0, 1.78, 0],
    divisionsU: 5,
    divisionsV: 5,
    metadata: { category: "coplanar" }
  });

  addCoplanarGrid(solid, {
    origin: [-4.0, 0.7001, -2.4],
    u: [7.5, 0, 0],
    v: [0, 0, 2.9],
    divisionsU: 6,
    divisionsV: 4,
    metadata: { category: "coplanar" }
  });

  addFarGates(solid);
  return solid;
}

function addFarGates(solid) {
  const forward = vec3.normalize(vec3.sub(FAR_POSE.target, FAR_POSE.eye));
  const right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
  const up = vec3.normalize(vec3.cross(right, forward));
  const distances = [120, 320, 760, 1600, 3200];
  const horizontal = [-0.56, -0.28, 0, 0.28, 0.56];
  const vertical = [0.13, -0.13, 0.13, -0.13, 0.13];

  distances.forEach((distance, index) => {
    const part = beginPart(solid, `far-gate-${index}`, gateColor, {
      category: "far",
      gateIndex: index,
      gateDistance: distance
    });
    const aspect = 16 / 9;
    const halfHeight = Math.tan(VIEW_CONFIG.fovY / 2) * distance;
    const center = vec3.add(
      vec3.add(FAR_POSE.eye, vec3.scale(forward, distance)),
      vec3.add(
        vec3.scale(right, horizontal[index] * halfHeight * aspect),
        vec3.scale(up, vertical[index] * halfHeight)
      )
    );
    const height = halfHeight * 0.2;
    const width = height * 1.48;
    const bar = Math.max(0.45, width * 0.026);

    addFrame(solid, {
      part,
      center,
      right,
      up,
      forward,
      width,
      height,
      bar,
      depth: bar * 0.65,
      metadata: { category: "far", gateIndex: index, gateDistance: distance }
    });

    addBox(solid, part, {
      center,
      size: [width * 0.66, bar * 0.55, bar * 0.6],
      right,
      up,
      forward,
      kind: "far-rail",
      metadata: { category: "far", gateIndex: index, gateDistance: distance }
    });

    const panel = beginPart(solid, `far-panel-${index}`, gatePanelColor, {
      category: "far-panel",
      gateIndex: index,
      gateDistance: distance
    });
    const panelDepth = bar * 0.36;
    addBox(solid, panel, {
      center,
      size: [width * 0.78, height * 0.76, panelDepth],
      right,
      up,
      forward,
      metadata: { category: "far-panel", gateIndex: index, gateDistance: distance }
    });
    const towardCamera = vec3.normalize(vec3.sub(FAR_POSE.eye, center));
    const faceSign = vec3.dot(towardCamera, forward) >= 0 ? 1 : -1;
    const faceCenter = vec3.add(center, vec3.scale(forward, faceSign * (panelDepth / 2 + 1e-4)));
    const gridWidth = width * 0.62;
    const gridHeight = height * 0.58;
    addCoplanarGrid(solid, {
      origin: vec3.add(
        vec3.add(faceCenter, vec3.scale(right, -gridWidth / 2)),
        vec3.scale(up, -gridHeight / 2)
      ),
      u: vec3.scale(right, gridWidth),
      v: vec3.scale(up, gridHeight),
      divisionsU: 5,
      divisionsV: 4,
      metadata: { category: "far", gateIndex: index, gateDistance: distance }
    });
  });
}

export function clonePose(pose) {
  return {
    ...pose,
    eye: pose.eye.slice(),
    target: pose.target.slice(),
    up: pose.up.slice()
  };
}
