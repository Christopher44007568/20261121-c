// Interactive stitch preview: draggable anchors, live arc-length
// resegmentation, glTF export. Reuses the shared core in ../src.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as M from '../src/mesh.js';
import * as S from '../src/stitch.js';
import { buildGLB } from '../src/gltf.js';
import { makeClothPiece, cornerAnchors } from '../test/fixtures.js';

const statusEl = document.getElementById('status');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f4f6);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
camera.position.set(1.6, -2.8, 2.6);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1.6, 1.3, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(2, 3, 5);
scene.add(sun);
scene.add(new THREE.GridHelper(8, 16, 0xcccccc, 0xe4e4e4));

const PALETTE = [0xe6194b, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0x469990];

const state = {
  scenario: 'unequal',
  meshA: null, meshB: null, loopA: null, loopB: null,
  anchors: [],
  seamObject: null, lineA: null, lineB: null,
  anchorSpheres: [], connectors: null,
  addingAnchor: false, pendingA: null,
  result: null,
};

function buildScenario(name) {
  let A, B, ptsA, ptsB;
  if (name === 'unequal') {
    A = makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: [0, 0, 0] });
    B = makeClothPiece({ name: 'pieceB', width: 3.2, height: 1.0, nx: 13, ny: 5, origin: [0.4, 1.6, 0] });
    ptsA = [[2, 1, 0], [1, 1, 0], [0, 1, 0]];
    ptsB = [[3.6, 1.6, 0], [2.0, 1.6, 0], [0.4, 1.6, 0]];
  } else if (name === 'reversed') {
    A = makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: [0, 0, 0] });
    B = makeClothPiece({ name: 'pieceB', width: 2.6, height: 1.0, nx: 11, ny: 5, origin: [0.3, 1.6, 0], flipWinding: true });
    ptsA = [[2, 1, 0], [1, 1, 0], [0, 1, 0]];
    ptsB = [[2.9, 1.6, 0], [1.6, 1.6, 0], [0.3, 1.6, 0]];
  } else {
    A = makeClothPiece({
      name: 'pieceA', width: 2.4, height: 1.0, nx: 12, ny: 6, origin: [0, 0, 0],
      notch: { edge: 'top', from: 0.8, to: 1.4, depth: 0.5 },
    });
    B = makeClothPiece({ name: 'pieceB', width: 2.4, height: 1.0, nx: 9, ny: 5, origin: [0.2, 1.6, 0] });
    ptsA = [[2.4, 1, 0], [1.4, 1, 0], [0.8, 1, 0], [0, 1, 0]];
    ptsB = [[2.6, 1.6, 0], [1.8, 1.6, 0], [1.0, 1.6, 0], [0.2, 1.6, 0]];
  }
  state.meshA = A;
  state.meshB = B;
  state.loopA = M.extractBoundaryLoops(A)[0];
  state.loopB = M.extractBoundaryLoops(B)[0];
  state.anchors = cornerAnchors(A, state.loopA, B, state.loopB, ptsA, ptsB);
  rebuild();
}

function disposeObj(obj) {
  if (!obj) return;
  scene.remove(obj);
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
  }
}

function anchorPos(side, t) {
  const mesh = side === 'a' ? state.meshA : state.meshB;
  const loop = side === 'a' ? state.loopA : state.loopB;
  const tab = M.loopArcTable(mesh, loop);
  return S.sampleLoop(mesh, loop, tab, t).pos;
}

function rebuild() {
  disposeObj(state.seamObject);
  disposeObj(state.lineA);
  disposeObj(state.lineB);
  disposeObj(state.connectors);
  for (const s of state.anchorSpheres) disposeObj(s);
  state.anchorSpheres = [];

  let res;
  try {
    res = S.stitch(state.meshA, state.loopA, state.meshB, state.loopB, state.anchors);
  } catch (e) {
    statusEl.textContent = '缝合失败: ' + e.message;
    return;
  }
  state.result = res;

  // stitched preview: one geometry, three groups (pieceA / pieceB / seam)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(res.positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(res.uvs, 2));
  geo.setAttribute('boundaryId', new THREE.Float32BufferAttribute(res.boundaryIds, 1));
  geo.setIndex(res.faces);
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0xa6c8f0, side: THREE.DoubleSide, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xf2c099, side: THREE.DoubleSide, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0x59d98c, side: THREE.DoubleSide, roughness: 0.6 }),
  ];
  res.groups.forEach((g, i) => {
    geo.addGroup(g.start, g.count, i);
  });
  state.seamObject = new THREE.Mesh(geo, mats);
  scene.add(state.seamObject);

  // boundary loop outlines
  const mkLine = (mesh, loop, color) => {
    const pts = loop.vertices.map((v) => new THREE.Vector3(...M.getPoint(mesh, v)));
    pts.push(pts[0].clone());
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  };
  state.lineA = mkLine(state.meshA, state.loopA, 0x2f6fb8);
  state.lineB = mkLine(state.meshB, state.loopB, 0xd97b29);
  scene.add(state.lineA, state.lineB);

  // anchor spheres + connectors
  const connPts = [];
  state.anchors.forEach((an, i) => {
    const color = PALETTE[i % PALETTE.length];
    for (const side of ['a', 'b']) {
      const p = anchorPos(side, an[side]);
      const sph = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 20, 14),
        new THREE.MeshStandardMaterial({ color })
      );
      sph.position.set(p[0], p[1], p[2] + 0.001);
      sph.userData = { anchorIndex: i, side };
      scene.add(sph);
      state.anchorSpheres.push(sph);
      connPts.push(new THREE.Vector3(...p));
    }
  });
  const connGeo = new THREE.BufferGeometry().setFromPoints(connPts);
  state.connectors = new THREE.LineSegments(
    connGeo, new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.05, gapSize: 0.04 })
  );
  state.connectors.computeLineDistances();
  scene.add(state.connectors);

  statusEl.textContent =
    '锚点对: ' + state.anchors.length +
    ' | 缝合采样: ' + res.debug.sampleCount +
    ' | 三角形: ' + (res.faces.length / 3);
}

// ---------- interaction ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragging = null;

function setPointer(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
}

function planePoint(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(dragPlane, p) ? p : null;
}

function nearestBoundaryPoint(mesh, loop, p) {
  // returns {t, point} snapped to the loop
  const t = S.snapToLoop(mesh, loop, [p.x, p.y, p.z]);
  const tab = M.loopArcTable(mesh, loop);
  return { t, point: S.sampleLoop(mesh, loop, tab, t).pos };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (state.addingAnchor) {
    const p = planePoint(e);
    if (!p) return;
    if (!state.pendingA) {
      const hit = nearestBoundaryPoint(state.meshA, state.loopA, p);
      state.pendingA = hit.t;
      statusEl.textContent = '已选 A 片边界点，请点击 B 片边界';
    } else {
      const hit = nearestBoundaryPoint(state.meshB, state.loopB, p);
      state.anchors.push({ a: state.pendingA, b: hit.t });
      state.anchors.sort((x, y) => x.a - y.a);
      state.pendingA = null;
      state.addingAnchor = false;
      document.getElementById('addAnchor').textContent = '添加锚点';
      rebuild();
    }
    return;
  }
  const hits = raycaster.intersectObjects(state.anchorSpheres);
  if (hits.length) {
    dragging = hits[0].object.userData;
    controls.enabled = false;
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = planePoint(e);
  if (!p) return;
  const mesh = dragging.side === 'a' ? state.meshA : state.meshB;
  const loop = dragging.side === 'a' ? state.loopA : state.loopB;
  const t = S.snapToLoop(mesh, loop, [p.x, p.y, p.z]);
  state.anchors[dragging.anchorIndex][dragging.side] = t;
  rebuild();
});

renderer.domElement.addEventListener('pointerup', () => {
  if (dragging) {
    dragging = null;
    controls.enabled = true;
    state.anchors.sort((x, y) => x.a - y.a);
    rebuild();
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(state.anchorSpheres);
  if (hits.length && state.anchors.length > 2) {
    state.anchors.splice(hits[0].object.userData.anchorIndex, 1);
    rebuild();
  }
});

document.getElementById('scenario').addEventListener('change', (e) => {
  state.scenario = e.target.value;
  buildScenario(state.scenario);
});

document.getElementById('addAnchor').addEventListener('click', (e) => {
  state.addingAnchor = !state.addingAnchor;
  state.pendingA = null;
  e.target.textContent = state.addingAnchor ? '取消添加' : '添加锚点';
  statusEl.textContent = state.addingAnchor ? '请点击 A 片（蓝）边界' : '';
});

document.getElementById('export').addEventListener('click', () => {
  if (!state.result) return;
  const glb = buildGLB(state.result, { name: 'stitch-' + state.scenario });
  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stitch-' + state.scenario + '.glb';
  a.click();
  URL.revokeObjectURL(a.href);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

buildScenario(state.scenario);

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();
