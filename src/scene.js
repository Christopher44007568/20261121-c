import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const STAGE_Y = -3;

function rockOffset(x, y, z, seed) {
  return (
    Math.sin(x * 1.7 + seed * 0.41) * 0.34 +
    Math.sin(y * 3.3 - seed * 0.23) * 0.22 +
    Math.sin(z * 2.4 + seed * 0.67) * 0.19 +
    Math.sin((x + y + z) * 5.8 + seed) * 0.11
  );
}

export function createRockGeometry(
  width,
  height,
  depth,
  seed,
  { segments = 4, radius = 0.22, roughness = 0.12 } = {},
) {
  const subdivisions = Math.max(3, segments * 2);
  const source = new THREE.BoxGeometry(
    width,
    height,
    depth,
    subdivisions,
    subdivisions,
    subdivisions,
  );
  source.deleteAttribute("uv");
  source.deleteAttribute("uv1");
  source.deleteAttribute("normal");

  const geometry = mergeVertices(source, 1e-4);
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const inner = new THREE.Vector3(
    Math.max(0, width / 2 - radius),
    Math.max(0, height / 2 - radius),
    Math.max(0, depth / 2 - radius),
  );
  const clamped = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    clamped.set(
      THREE.MathUtils.clamp(vertex.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(vertex.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(vertex.z, -inner.z, inner.z),
    );
    direction.subVectors(vertex, clamped).normalize();
    vertex.copy(clamped).addScaledVector(direction, radius);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    direction.fromBufferAttribute(normal, index);
    const offset = rockOffset(vertex.x, vertex.y, vertex.z, seed) * roughness;
    vertex.addScaledVector(direction, offset);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  geometry.deleteAttribute("uv");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeContactShadow(radius) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 3, 128, 128, 123);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.62)");
  gradient.addColorStop(0.5, "rgba(0, 0, 0, 0.3)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      color: 0x000000,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

function makePlatform(radius) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.04, 0.38, 48),
    new THREE.MeshStandardMaterial({
      color: 0x1b211e,
      roughness: 0.72,
      metalness: 0.14,
    }),
  );
  base.position.y = STAGE_Y + 0.19;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.86, 0.012, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x7d6f54, transparent: true, opacity: 0.36 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = STAGE_Y + 0.39;
  group.add(base, ring);
  return group;
}

export function createLab(renderer, material) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0e0c, 0.017);

  const camera = new THREE.PerspectiveCamera(
    42,
    renderer.domElement.clientWidth / renderer.domElement.clientHeight,
    0.1,
    100,
  );
  camera.position.set(14, 5.6, 20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 4;
  controls.maxDistance = 38;
  controls.minPolarAngle = 0.04;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.update();

  const hemisphere = new THREE.HemisphereLight(0xaeb9a9, 0x11120f, 1.2);
  const key = new THREE.DirectionalLight(0xe9c998, 2.4);
  key.position.set(-8, 12, 7);
  const rim = new THREE.DirectionalLight(0x77938c, 1.2);
  rim.position.set(10, 4, -8);
  scene.add(hemisphere, key, rim);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ color: 0x0f1411, roughness: 0.94, metalness: 0.03 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = STAGE_Y - 0.02;
  scene.add(floor);

  const grid = new THREE.GridHelper(50, 50, 0x405248, 0x202b25);
  grid.position.y = STAGE_Y + 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  scene.add(grid);

  return { scene, camera, controls };
}

export function addTestModels(scene, material) {
  const modelGroup = new THREE.Group();
  modelGroup.name = "triplanar-test-models";
  scene.add(modelGroup);

  const slopeGeometry = createRockGeometry(4.8, 4.5, 3.1, 4.2, {
    segments: 5,
    radius: 0.34,
    roughness: 0.13,
  });
  const wallGeometry = createRockGeometry(4.7, 6.4, 1.55, 11.7, {
    segments: 5,
    radius: 0.28,
    roughness: 0.11,
  });
  const roofGeometry = createRockGeometry(25, 1.45, 13, 23.1, {
    segments: 5,
    radius: 0.42,
    roughness: 0.15,
  });

  const slope = new THREE.Mesh(slopeGeometry, material);
  slope.name = "01-slope";
  slope.position.set(-7.35, -0.25, 0);
  slope.rotation.set(0.08, 0.4, -0.31);
  slope.userData.label = "01 / SLOPE";

  const wall = new THREE.Mesh(wallGeometry, material);
  wall.name = "02-vertical-wall";
  wall.position.set(0.25, 0.25, 0);
  wall.rotation.set(0.02, -0.08, 0);
  wall.userData.label = "02 / VERTICAL WALL";

  const mirrored = new THREE.Mesh(wallGeometry, material);
  mirrored.name = "03-mirrored-instance";
  mirrored.position.set(7.45, 0.25, 0);
  mirrored.rotation.set(0.02, -0.08, 0);
  mirrored.scale.x = -1;
  mirrored.userData.label = "03 / NEGATIVE SCALE";
  mirrored.userData.mirrored = true;

  const caveRoof = new THREE.Mesh(roofGeometry, material);
  caveRoof.name = "cave-ceiling";
  caveRoof.position.set(0, 8.45, 1.8);
  caveRoof.rotation.set(0.015, 0.08, 0.012);
  caveRoof.userData.label = "CAVE CEILING / DOWN-FACING";

  const shardBottom = createRockGeometry(5.8, 0.82, 4.2, 41.2, {
    segments: 4,
    radius: 0.24,
    roughness: 0.12,
  });
  const floatingShard = new THREE.Mesh(shardBottom, material);
  floatingShard.position.set(-11.7, 1.2, -5.2);
  floatingShard.rotation.set(0.03, -0.2, 0.08);
  floatingShard.name = "floating-bottom-face";
  floatingShard.userData.label = "BOTTOM FACE";

  modelGroup.add(slope, wall, mirrored, caveRoof, floatingShard);

  const platformData = [
    [-7.35, 2.65],
    [0.25, 2.35],
    [7.45, 2.35],
  ];
  for (const [x, radius] of platformData) {
    const platform = makePlatform(radius);
    platform.position.x = x;
    platform.position.z = 0;
    modelGroup.add(platform);
    const shadow = makeContactShadow(radius * 1.02);
    shadow.position.set(x, STAGE_Y + 0.405, 0);
    modelGroup.add(shadow);
  }

  const labels = [
    {
      element: null,
      position: new THREE.Vector3(-7.2, 2.75, 0.5),
      text: "01 / 斜面 SLOPE",
      note: "倾斜法线",
      scopes: ["overview", "underside"],
    },
    {
      element: null,
      position: new THREE.Vector3(0.3, 3.75, 0.9),
      text: "02 / 竖壁 WALL",
      note: "无 UV",
      scopes: ["overview"],
    },
    {
      element: null,
      position: new THREE.Vector3(7.35, 3.75, 0.9),
      text: "03 / 反向缩放",
      note: "det < 0",
      className: "mirror",
      scopes: ["overview", "mirror"],
    },
    {
      element: null,
      position: new THREE.Vector3(3.2, 7.72, -0.2),
      text: "洞顶 CEILING",
      note: "N 朝下",
      scopes: ["overview", "ceiling"],
    },
    {
      element: null,
      position: new THREE.Vector3(-11.7, 0.82, -4.5),
      text: "底面 BOTTOM",
      note: "仰视检查",
      scopes: ["underside"],
    },
  ];

  const presets = {
    overview: {
      position: new THREE.Vector3(14, 5.6, 20),
      target: new THREE.Vector3(0, 0.2, 0),
      label: "总览",
      detail: "三个无 UV 试件 · 1 m 世界投影 · 1 m 网格",
    },
    ceiling: {
      position: new THREE.Vector3(9.6, 1.1, 11.4),
      target: new THREE.Vector3(0.6, 7.7, 1.2),
      label: "洞顶底面",
      detail: "倒置法线 · 补光揭示 Y 轴投影与法线方向",
    },
    underside: {
      position: new THREE.Vector3(-10.2, -1.8, -11.5),
      target: new THREE.Vector3(-11.7, 0.82, -5.2),
      label: "悬空底面",
      detail: "从下方仰视 · 检查法线贴图重定向后的明暗",
    },
    mirror: {
      position: new THREE.Vector3(11.2, 3.4, 8.8),
      target: new THREE.Vector3(7.45, 0.7, 0),
      label: "镜像实例",
      detail: "scale.x = −1 · 行列式感知的逆矩阵法线变换",
    },
  };

  return { modelGroup, presets, labels, slope, wall, mirrored, caveRoof, floatingShard };
}
