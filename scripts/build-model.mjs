import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "public");
const SEGMENTS = 32;
const SHOULDER = [0.16, 1.35, 0];
const ELBOW = [1.12, 1.35, 0];
const WRIST = [2.08, 1.35, 0];
const HAND_TIP = [2.65, 1.35, 0];

const STATIONS = [
  [0.06, 0.055],
  [0.12, 0.135],
  [0.26, 0.195],
  [0.5, 0.21],
  [0.78, 0.198],
  [0.97, 0.18],
  [1.05, 0.172],
  [1.12, 0.168],
  [1.2, 0.174],
  [1.38, 0.18],
  [1.62, 0.174],
  [1.84, 0.158],
  [1.97, 0.136],
  [2.04, 0.122],
  [2.08, 0.112],
  [2.14, 0.125],
  [2.28, 0.145],
  [2.42, 0.135],
  [2.53, 0.108],
  [2.59, 0.065],
  [2.62, 0.025],
];

const smoothstep = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function weightsAt(x) {
  if (x < 1.02) return [1, 0, 0, 0];
  if (x < 1.22) {
    const t = smoothstep((x - 1.02) / 0.2);
    return [1 - t, t, 0, 0];
  }
  if (x < 1.99) return [0, 1, 0, 0];
  if (x < 2.17) {
    const t = smoothstep((x - 1.99) / 0.18);
    return [0, 1 - t, t, 0];
  }
  return [0, 0, 1, 0];
}

function buildMesh() {
  const positions = [];
  const normals = [];
  const joints = [];
  const weights = [];
  const indices = [];
  const ringStarts = [];
  const ringRadii = [];

  for (const [x, radius] of STATIONS) {
    ringStarts.push(positions.length / 3);
    ringRadii.push(radius);
    const weight = weightsAt(x);
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const y = Math.cos(angle);
      const z = Math.sin(angle);
      positions.push(x, SHOULDER[1] + radius * y, radius * z);
      normals.push(0, y, z);
      joints.push(0, 1, 2, 3);
      weights.push(...weight);
    }
  }

  for (let ring = 0; ring < STATIONS.length - 1; ring += 1) {
    const current = ringStarts[ring];
    const next = ringStarts[ring + 1];
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const following = (segment + 1) % SEGMENTS;
      const a = current + segment;
      const b = current + following;
      const c = next + segment;
      const d = next + following;
      indices.push(a, b, c, b, d, c);
    }
  }

  const startCenter = positions.length / 3;
  positions.push(STATIONS[0][0], SHOULDER[1], 0);
  normals.push(-1, 0, 0);
  joints.push(0, 1, 2, 3);
  weights.push(1, 0, 0, 0);

  const endCenter = positions.length / 3;
  const last = STATIONS.length - 1;
  positions.push(STATIONS[last][0], SHOULDER[1], 0);
  normals.push(1, 0, 0);
  joints.push(0, 1, 2, 3);
  weights.push(0, 0, 1, 0);

  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    const following = (segment + 1) % SEGMENTS;
    indices.push(startCenter, ringStarts[0] + following, ringStarts[0] + segment);
    indices.push(endCenter, ringStarts[last] + segment, ringStarts[last] + following);
  }

  return {
    positions,
    normals,
    joints,
    weights,
    indices,
    ringStarts,
    ringRadii,
  };
}

function rotationQuaternion(axis, degrees) {
  const half = (degrees * Math.PI) / 360;
  const sine = Math.sin(half);
  if (axis === "x") return [sine, 0, 0, Math.cos(half)];
  return [0, 0, sine, Math.cos(half)];
}

function makeAnimation(times, angles, axis) {
  return {
    times,
    values: angles.flatMap((angle) => rotationQuaternion(axis, angle)),
  };
}

const WRIST_ANGLES = [0, 60, 120, 180, 240, 180, 120, 60, 0];
const ELBOW_ANGLES = [0, 30, 60, 90, 110, 90, 60, 30, 0];
const TIMES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

const mesh = buildMesh();
const wristAnimation = makeAnimation(TIMES, WRIST_ANGLES, "x");
const elbowAnimation = makeAnimation(TIMES, ELBOW_ANGLES, "z");

function inverseBindTranslation(position) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -position[0], -position[1], -position[2], 1];
}

const inverseBindMatrices = [
  ...inverseBindTranslation(SHOULDER),
  ...inverseBindTranslation(ELBOW),
  ...inverseBindTranslation(WRIST),
  ...inverseBindTranslation(HAND_TIP),
];

const gltf = {
  asset: {
    version: "2.0",
    generator: "Skin Lab procedural arm",
  },
  scene: 0,
  scenes: [{ nodes: [0, 4] }],
  nodes: [
    {
      name: "upperArm",
      translation: SHOULDER,
      children: [1],
    },
    {
      name: "forearm",
      translation: [ELBOW[0] - SHOULDER[0], 0, 0],
      children: [2],
    },
    {
      name: "hand",
      translation: [WRIST[0] - ELBOW[0], 0, 0],
      children: [3],
    },
    {
      name: "handTip",
      translation: [HAND_TIP[0] - WRIST[0], 0, 0],
    },
    {
      name: "ArmMesh",
      mesh: 0,
      skin: 0,
    },
  ],
  skins: [
    {
      name: "ArmRig",
      skeleton: 0,
      joints: [0, 1, 2, 3],
      inverseBindMatrices: 4,
    },
  ],
  meshes: [
    {
      name: "ForearmStressMesh",
      primitives: [
        {
          attributes: {
            POSITION: 0,
            NORMAL: 1,
            JOINTS_0: 2,
            WEIGHTS_0: 3,
          },
          indices: 5,
          material: 0,
        },
      ],
    },
  ],
  materials: [
    {
      name: "Skin Clay",
      pbrMetallicRoughness: {
        baseColorFactor: [0.55, 0.74, 0.66, 1],
        metallicFactor: 0.08,
        roughnessFactor: 0.72,
      },
      doubleSided: true,
    },
  ],
  animations: [
    {
      name: "WristTwist240",
      samplers: [{ input: 6, output: 7, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
    },
    {
      name: "ElbowBend110",
      samplers: [{ input: 8, output: 9, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
    },
  ],
};

await mkdir(OUT_DIR, { recursive: true });

const meta = {
  segments: SEGMENTS,
  stationCount: STATIONS.length,
  stationX: STATIONS.map(([x]) => x),
  ringStarts: mesh.ringStarts,
  ringRadii: mesh.ringRadii,
  jointNames: ["upperArm", "forearm", "hand", "handTip"],
  slices: {
    wrist: [11, 12, 13, 14, 15, 16],
    elbow: [4, 5, 6, 7, 8, 9],
  },
  animation: {
    wrist: { name: "WristTwist240", duration: 4, maxAngle: 240, joint: 2 },
    elbow: { name: "ElbowBend110", duration: 4, maxAngle: 110, joint: 1 },
  },
};

await writeFile(resolve(OUT_DIR, "arm-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

const accessors = [];
const bufferViews = [];
const binaryParts = [];
let byteOffset = 0;

function addView(data, componentType, type, count, options = {}) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const padding = (4 - (byteOffset % 4)) % 4;
  if (padding) {
    binaryParts.push(Buffer.alloc(padding));
    byteOffset += padding;
  }
  const view = {
    buffer: 0,
    byteOffset,
    byteLength: bytes.byteLength,
  };
  if (options.target) view.target = options.target;
  bufferViews.push(view);
  binaryParts.push(bytes);
  byteOffset += bytes.byteLength;

  const accessor = {
    bufferView: bufferViews.length - 1,
    componentType,
    count,
    type,
  };
  if (options.bounds && (type === "SCALAR" || type === "VEC3")) {
    const values = Array.from(data);
    const width = type === "SCALAR" ? 1 : 3;
    for (let axis = 0; axis < width; axis += 1) {
      const slice = values.filter((_, index) => index % width === axis);
      accessor.min ??= [];
      accessor.max ??= [];
      accessor.min.push(Math.min(...slice));
      accessor.max.push(Math.max(...slice));
    }
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

const positionAccessor = addView(
  new Float32Array(mesh.positions),
  5126,
  "VEC3",
  mesh.positions.length / 3,
  { bounds: true, target: 34962 },
);
const normalAccessor = addView(
  new Float32Array(mesh.normals),
  5126,
  "VEC3",
  mesh.normals.length / 3,
  { target: 34962 },
);
const jointAccessor = addView(
  new Uint16Array(mesh.joints),
  5123,
  "VEC4",
  mesh.joints.length / 4,
  { target: 34962 },
);
const weightAccessor = addView(
  new Float32Array(mesh.weights),
  5126,
  "VEC4",
  mesh.weights.length / 4,
  { target: 34962 },
);
const inverseBindAccessor = addView(
  new Float32Array(inverseBindMatrices),
  5126,
  "MAT4",
  4,
);
const indexAccessor = addView(
  new Uint16Array(mesh.indices),
  5123,
  "SCALAR",
  mesh.indices.length,
  { target: 34963 },
);
const wristTimeAccessor = addView(
  new Float32Array(TIMES),
  5126,
  "SCALAR",
  TIMES.length,
  { bounds: true },
);
const wristValueAccessor = addView(
  new Float32Array(wristAnimation.values),
  5126,
  "VEC4",
  WRIST_ANGLES.length,
);
const elbowTimeAccessor = addView(
  new Float32Array(TIMES),
  5126,
  "SCALAR",
  TIMES.length,
  { bounds: true },
);
const elbowValueAccessor = addView(
  new Float32Array(elbowAnimation.values),
  5126,
  "VEC4",
  ELBOW_ANGLES.length,
);

gltf.bufferViews = bufferViews;
gltf.accessors = accessors;
gltf.skins[0].inverseBindMatrices = inverseBindAccessor;
gltf.meshes[0].primitives[0].attributes.POSITION = positionAccessor;
gltf.meshes[0].primitives[0].attributes.NORMAL = normalAccessor;
gltf.meshes[0].primitives[0].attributes.JOINTS_0 = jointAccessor;
gltf.meshes[0].primitives[0].attributes.WEIGHTS_0 = weightAccessor;
gltf.meshes[0].primitives[0].indices = indexAccessor;
gltf.animations[0].samplers[0].input = wristTimeAccessor;
gltf.animations[0].samplers[0].output = wristValueAccessor;
gltf.animations[1].samplers[0].input = elbowTimeAccessor;
gltf.animations[1].samplers[0].output = elbowValueAccessor;

const buffer = Buffer.concat(binaryParts);
const base64 = buffer.toString("base64");
gltf.buffers = [
  {
    byteLength: buffer.byteLength,
    uri: `data:application/octet-stream;base64,${base64}`,
  },
];

await writeFile(resolve(OUT_DIR, "arm.gltf"), `${JSON.stringify(gltf)}\n`);
console.log(`Wrote public/arm.gltf (${(buffer.byteLength / 1024).toFixed(1)} KiB binary)`);
console.log(`Vertices: ${mesh.positions.length / 3}, triangles: ${mesh.indices.length / 3}`);
