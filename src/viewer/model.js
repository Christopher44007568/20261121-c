import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PALETTE = {
  teal: 0x416a62,
  tealDark: 0x203431,
  graphite: 0x1a2323,
  steel: 0x9aa8a5,
  copper: 0xbb6f42,
  orange: 0xe77a42,
  brass: 0xc7a15e,
  black: 0x0e1515,
};

function standard(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.72,
    roughness: options.roughness ?? 0.34,
    ...options,
  });
}

function markPickable(mesh, entry) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pickEntry = entry;
  return entry;
}

function addPickable(pickables, parent, geometry, material, entry) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  const pickable = markPickable(mesh, { ...entry, mesh });
  pickables.push(pickable);
  return pickable;
}

function createGrilleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 256, 128);

  context.fillStyle = "#000000";
  const radius = 7;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = 12 + column * 30;
      const y = 11 + row * 22;
      context.beginPath();
      context.roundRect(x, y, 21, 14, radius);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createGlassEdges(geometry) {
  const edges = new THREE.EdgesGeometry(geometry, 18);
  const material = new THREE.LineBasicMaterial({
    color: 0x7db7ff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  return new THREE.LineSegments(edges, material);
}

function createInstancedEntry(pickables, root, geometry, material, options) {
  const mesh = new THREE.InstancedMesh(geometry, material, options.count);
  mesh.name = options.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let index = 0; index < options.count; index += 1) {
    options.place(dummy, index);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const entry = {
    name: options.name,
    category: options.category,
    color: options.color,
    kind: "solid",
    mesh,
    instances: Array.from({ length: options.count }, (_, index) => ({
      index,
      name: options.instanceName(index),
    })),
  };
  mesh.userData.pickEntry = entry;
  pickables.push(entry);
  root.add(mesh);
  return entry;
}

function addInstancedParts(root, pickables, materials) {
  const boltGeometry = new THREE.CylinderGeometry(0.082, 0.082, 0.11, 6);
  createInstancedEntry(pickables, root, boltGeometry, materials.steelMaterial, {
    name: "Flange bolt M6",
    category: "Fastener",
    color: "#d6a16b",
    count: 12,
    instanceName: (index) => `M6 × 18 · instance ${String(index + 1).padStart(2, "0")}`,
    place: (dummy, index) => {
      const angle = (index / 12) * Math.PI * 2 + Math.PI / 12;
      dummy.position.set(Math.cos(angle) * 1.16, Math.sin(angle) * 1.16 + 0.02, 1.37);
      dummy.rotation.set(Math.PI / 2, 0, 0);
    },
  });

  const finGeometry = new THREE.BoxGeometry(0.065, 0.58, 0.74);
  createInstancedEntry(pickables, root, finGeometry, materials.darkMaterial, {
    name: "Heat exchanger fin",
    category: "Thermal",
    color: "#5c8a80",
    count: 8,
    instanceName: (index) => `Fin pack A · blade ${String(index + 1).padStart(2, "0")}`,
    place: (dummy, index) => {
      dummy.position.set(0.66 + index * 0.117, 1.33, -0.73);
      dummy.rotation.set(-0.07, 0, 0.03);
    },
  });

  const rollerGeometry = new THREE.CylinderGeometry(0.105, 0.105, 0.25, 12);
  createInstancedEntry(pickables, root, rollerGeometry, materials.redMaterial, {
    name: "Bearing roller",
    category: "Bearing",
    color: "#e99c70",
    count: 9,
    instanceName: (index) => `Race B · roller ${String(index + 1).padStart(2, "0")}`,
    place: (dummy, index) => {
      const angle = (index / 9) * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * 0.55, Math.sin(angle) * 0.55 + 0.02, 1.61);
      dummy.rotation.set(0, 0, angle);
    },
  });
}

function addSecondaryParts(root, pickables, materials) {
  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.3, -0.24, -1.16),
    new THREE.Vector3(-0.75, -0.42, -1.35),
    new THREE.Vector3(0.3, -0.28, -1.37),
    new THREE.Vector3(1.15, -0.1, -1.18),
  ]);
  addPickable(
    pickables,
    root,
    new THREE.TubeGeometry(pipeCurve, 36, 0.092, 10, false),
    materials.steelMaterial,
    {
      name: "Coolant return pipe",
      category: "Plumbing",
      color: "#c6d1ce",
      kind: "solid",
    },
  );

  const cover = addPickable(
    pickables,
    root,
    new RoundedBoxGeometry(0.1, 1.12, 0.92, 3, 0.06),
    materials.graphiteMaterial,
    {
      name: "Service access cover",
      category: "Service",
      color: "#6d7b78",
      kind: "solid",
    },
  );
  cover.mesh.position.set(-2.04, 0.02, -0.12);

  for (let index = 0; index < 4; index += 1) {
    const foot = addPickable(
      pickables,
      root,
      new THREE.CylinderGeometry(0.19, 0.23, 0.2, 20),
      materials.graphiteMaterial,
      {
        name: `Isolation foot ${index + 1}`,
        category: "Mount",
        color: "#596663",
        kind: "solid",
      },
    );
    const x = index % 2 === 0 ? -1.8 : 1.8;
    const z = index < 2 ? -1.05 : 1.05;
    foot.mesh.position.set(x, -1.42, z);
  }

  const badge = addPickable(
    pickables,
    root,
    new THREE.BoxGeometry(0.7, 0.026, 0.2),
    materials.darkMaterial,
    {
      name: "Serial badge",
      category: "Label",
      color: "#50645f",
      kind: "solid",
    },
  );
  badge.mesh.position.set(0.2, -0.99, 1.13);
}

export function createAssembly() {
  const root = new THREE.Group();
  root.name = "Transmission housing";
  const pickables = [];

  const housingMaterial = standard(PALETTE.teal, { metalness: 0.78, roughness: 0.3 });
  const darkMaterial = standard(PALETTE.tealDark, { metalness: 0.72, roughness: 0.39 });
  const graphiteMaterial = standard(PALETTE.graphite, { metalness: 0.62, roughness: 0.5 });
  const steelMaterial = standard(PALETTE.steel, { metalness: 0.94, roughness: 0.2 });
  const copperMaterial = standard(PALETTE.copper, { metalness: 0.82, roughness: 0.25 });
  const orangeMaterial = standard(PALETTE.orange, { metalness: 0.55, roughness: 0.3 });

  addPickable(pickables, root, new RoundedBoxGeometry(4.9, 0.48, 3.05, 4, 0.1), graphiteMaterial, {
    name: "Mounting plinth",
    category: "Structure",
    color: "#6d7b78",
    kind: "solid",
  }).mesh.position.set(0, -1.18, 0);

  addPickable(pickables, root, new RoundedBoxGeometry(4.05, 1.92, 2.25, 5, 0.18), housingMaterial, {
    name: "Main gear housing",
    category: "Structure",
    color: "#7cc4b5",
    kind: "solid",
  }).mesh.position.set(0, -0.03, 0);

  addPickable(pickables, root, new RoundedBoxGeometry(4.2, 0.18, 2.38, 3, 0.05), darkMaterial, {
    name: "Upper seam plate",
    category: "Structure",
    color: "#5d9187",
    kind: "solid",
  }).mesh.position.set(0, 0.9, 0);

  const cylinder = new THREE.CylinderGeometry(0.92, 1.06, 0.66, 48, 1, false);
  const chamber = addPickable(pickables, root, cylinder, darkMaterial, {
    name: "Inspection chamber",
    category: "Structure",
    color: "#5d9187",
    kind: "solid",
  });
  chamber.mesh.position.set(-0.88, 1.31, 0.08);

  const rotor = addPickable(pickables, root, new THREE.CylinderGeometry(0.67, 0.67, 0.12, 40), orangeMaterial, {
    name: "Index rotor",
    category: "Rotation",
    color: "#e77a42",
    kind: "solid",
  });
  rotor.mesh.position.set(-0.88, 1.68, 0.08);
  rotor.mesh.rotation.y = 0.28;

  const rotorMark = addPickable(
    pickables,
    root,
    new RoundedBoxGeometry(0.44, 0.05, 0.1, 2, 0.02),
    steelMaterial,
    {
      name: "Rotor index mark",
      category: "Rotation",
      color: "#c0cfcb",
      kind: "solid",
    },
  );
  rotorMark.mesh.position.set(-0.88, 1.76, 0.08);

  const glassGeometry = new THREE.CylinderGeometry(0.98, 1.13, 0.48, 48, 1, true);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8fc6ff,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.15,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const displayLayer = new THREE.Group();
  displayLayer.name = "Inspection display layer";
  displayLayer.userData.selectionLayer = "display";
  const glass = new THREE.Mesh(glassGeometry, glassMaterial);
  glass.position.set(-0.88, 1.68, 0.08);
  glass.renderOrder = 5;
  glass.castShadow = false;
  displayLayer.add(glass);
  const glassEdges = createGlassEdges(glassGeometry);
  glassEdges.position.copy(glass.position);
  displayLayer.add(glassEdges);
  root.add(displayLayer);

  const flange = addPickable(
    pickables,
    root,
    new THREE.CylinderGeometry(1.32, 1.32, 0.27, 64),
    copperMaterial,
    {
      name: "Front bearing flange",
      category: "Drive",
      color: "#bb6f42",
      kind: "solid",
    },
  );
  flange.mesh.rotation.x = Math.PI / 2;
  flange.mesh.position.set(0, 0.02, 1.16);

  const hub = addPickable(
    pickables,
    root,
    new THREE.CylinderGeometry(0.79, 0.92, 0.43, 48),
    steelMaterial,
    {
      name: "Output hub",
      category: "Drive",
      color: "#c6d1ce",
      kind: "solid",
    },
  );
  hub.mesh.rotation.x = Math.PI / 2;
  hub.mesh.position.set(0, 0.02, 1.39);

  const shaft = addPickable(
    pickables,
    root,
    new THREE.CylinderGeometry(0.31, 0.31, 1.05, 32),
    darkMaterial,
    {
      name: "Output shaft",
      category: "Drive",
      color: "#29433e",
      kind: "solid",
    },
  );
  shaft.mesh.rotation.x = Math.PI / 2;
  shaft.mesh.position.set(0, 0.02, 1.9);

  const ring = addPickable(pickables, root, new THREE.TorusGeometry(1.12, 0.055, 10, 64), steelMaterial, {
    name: "Flange lock ring",
    category: "Drive",
    color: "#c6d1ce",
    kind: "solid",
  });
  ring.mesh.position.set(0, 0.02, 1.32);

  const ventCavity = addPickable(
    pickables,
    root,
    new RoundedBoxGeometry(1.83, 0.16, 0.94, 2, 0.03),
    orangeMaterial,
    {
      name: "Vent cavity",
      category: "Thermal",
      color: "#e77a42",
      kind: "solid",
    },
  );
  ventCavity.mesh.position.set(0.96, 1.01, -0.12);

  const grilleTexture = createGrilleTexture();
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: 0xb4c2be,
    metalness: 0.9,
    roughness: 0.24,
    alphaMap: grilleTexture,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const grille = addPickable(pickables, root, new THREE.PlaneGeometry(1.86, 0.98), grilleMaterial, {
    name: "Perforated vent grille",
    category: "Cutout",
    color: "#b4c2be",
    kind: "cutout",
    alphaMap: grilleTexture,
    alphaTest: 0.5,
  });
  grille.mesh.rotation.x = -Math.PI / 2;
  grille.mesh.position.set(0.96, 1.11, -0.12);

  addInstancedParts(root, pickables, {
    steelMaterial,
    darkMaterial,
    redMaterial: orangeMaterial,
  });
  addSecondaryParts(root, pickables, {
    steelMaterial,
    darkMaterial,
    graphiteMaterial,
  });

  return {
    root,
    pickables,
    displayLayer,
  };
}
