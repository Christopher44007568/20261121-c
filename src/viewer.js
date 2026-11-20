import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildContinuityEdges } from "./metrics.js";
import { makeSkinEvaluator } from "./skinning.js";

const LBS_LAYER = 1;
const DQ_LAYER = 2;

const VIEW_PRESETS = {
  perspective: {
    target: new THREE.Vector3(1.3, 1.36, 0),
    distance: 7.1,
    azimuth: 0.66,
    polar: 1.34,
  },
  side: {
    target: new THREE.Vector3(1.3, 1.35, 0),
    distance: 6.4,
    azimuth: 0,
    polar: Math.PI / 2,
  },
  axis: {
    target: new THREE.Vector3(2.06, 1.35, 0),
    distance: 5.4,
    azimuth: Math.PI / 2,
    polar: Math.PI / 2,
  },
};

function readAttribute(attribute, components) {
  const result = new Float32Array(attribute.count * components);
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < components; component += 1) {
      result[index * components + component] =
        attribute[`get${["X", "Y", "Z", "W"][component]}`](index);
    }
  }
  return result;
}

function makeGeometry(positions, indices, layer) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions.slice(), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.layer = layer;
  return geometry;
}

function makeSphericalCamera(state) {
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  const sinPolar = Math.sin(state.polar);
  camera.position.set(
    state.target.x + state.distance * sinPolar * Math.sin(state.azimuth),
    state.target.y + state.distance * Math.cos(state.polar),
    state.target.z + state.distance * sinPolar * Math.cos(state.azimuth),
  );
  camera.lookAt(state.target);
  return camera;
}

export class SkinViewer {
  constructor(canvas, meta) {
    this.canvas = canvas;
    this.meta = meta;
    this.animation = "wrist";
    this.activeView = "perspective";
    this.playing = true;
    this.time = 2;
    this.scaleStress = false;
    this.skeletonVisible = true;
    this.ringsVisible = true;
    this.wireVisible = false;
    this.cameraState = {
      target: VIEW_PRESETS.perspective.target.clone(),
      distance: VIEW_PRESETS.perspective.distance,
      azimuth: VIEW_PRESETS.perspective.azimuth,
      polar: VIEW_PRESETS.perspective.polar,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080d0b);
    this.scene.fog = new THREE.Fog(0x080d0b, 7.6, 13.5);

    this.leftCamera = makeSphericalCamera(this.cameraState);
    this.rightCamera = makeSphericalCamera(this.cameraState);
    this.leftCamera.layers.set(0);
    this.leftCamera.layers.enable(LBS_LAYER);
    this.rightCamera.layers.set(0);
    this.rightCamera.layers.enable(DQ_LAYER);

    this.bindPointerControls();
  }

  setStatus(callback) {
    this.statusCallback = callback;
  }

  async load(url) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    this.gltf = gltf;
    this.root = gltf.scene;
    this.scene.add(this.root);

    this.sourceMesh = null;
    this.root.traverse((object) => {
      if (object.isSkinnedMesh && !this.sourceMesh) this.sourceMesh = object;
    });
    if (!this.sourceMesh) throw new Error("glTF 中没有找到 SkinnedMesh");

    this.skeleton = this.sourceMesh.skeleton;
    this.bones = this.skeleton.bones;
    this.sourceMesh.visible = false;
    this.forearm = this.bones.find((bone) => bone.name === "forearm");
    this.hand = this.bones.find((bone) => bone.name === "hand");
    this.sourceGeometry = this.sourceMesh.geometry;
    this.positions = readAttribute(this.sourceGeometry.attributes.position, 3);
    this.joints = this.sourceGeometry.attributes.skinIndex;
    this.weights = this.sourceGeometry.attributes.skinWeight;
    this.jointArray = new Uint16Array(this.positions.length / 3 * 4);
    this.weightArray = new Float32Array(this.positions.length / 3 * 4);
    for (let index = 0; index < this.jointArray.length; index += 1) {
      this.jointArray[index] = this.joints.getComponent(index >> 2, index & 3);
      this.weightArray[index] =
        this.weights.getComponent(index >> 2, index & 3);
    }

    this.indices =
      this.sourceGeometry.index?.array ??
      new Uint32Array(Array.from({ length: this.positions.length / 3 }, (_, index) => index));
    this.indices =
      this.indices instanceof Uint32Array
        ? this.indices
        : new Uint32Array(this.indices);

    const inverses = new Float32Array(this.bones.length * 16);
    this.skeleton.boneInverses.forEach((matrix, bone) => {
      inverses.set(matrix.elements, bone * 16);
    });
    this.evaluator = makeSkinEvaluator({
      positions: this.positions,
      joints: this.jointArray,
      weights: this.weightArray,
      inverseBindMatrices: inverses,
      ringStarts: this.meta.ringStarts,
      segments: this.meta.segments,
    });
    this.edges = buildContinuityEdges(this.meta.ringStarts, this.meta.segments);
    this.skinMatrices = new Float32Array(this.bones.length * 16);
    this.matrix = new THREE.Matrix4();

    this.setupScenery();
    this.setupMeshes();
    this.setupRings();
    this.setupSkeleton();
    this.setupAnimations();
    this.statusCallback?.(`GLTF READY · ${this.positions.length / 3} VERTICES`);
    return this;
  }

  setupScenery() {
    const hemisphere = new THREE.HemisphereLight(0xbdebd7, 0x0b100e, 1.9);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffd7b0, 3.2);
    key.position.set(4.5, 7, 5.5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x79a9ff, 1.75);
    fill.position.set(-4, 2.5, -3);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x8df0c9, 1.25);
    rim.position.set(1.5, 3.5, -6);
    this.scene.add(rim);

    const grid = new THREE.GridHelper(12, 24, 0x284238, 0x16251f);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.58;
    grid.material.depthWrite = false;
    this.scene.add(grid);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.405, 96),
      new THREE.MeshBasicMaterial({
        color: 0x376352,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(1.3, 0.025, 0);
    this.scene.add(halo);
  }

  setupMeshes() {
    const meshes = new THREE.Group();
    const materialOptions = {
      roughness: 0.48,
      metalness: 0.16,
      side: THREE.DoubleSide,
      envMapIntensity: 0.5,
    };
    this.lbsMaterial = new THREE.MeshStandardMaterial({
      ...materialOptions,
      color: 0xc8a275,
      emissive: 0x1e1207,
      emissiveIntensity: 0.42,
    });
    this.dqMaterial = new THREE.MeshStandardMaterial({
      ...materialOptions,
      color: 0x8cc9b2,
      emissive: 0x071d16,
      emissiveIntensity: 0.54,
    });
    this.lbsGeometry = makeGeometry(this.positions, this.indices, LBS_LAYER);
    this.dqGeometry = makeGeometry(this.positions, this.indices, DQ_LAYER);
    this.lbsMesh = new THREE.Mesh(this.lbsGeometry, this.lbsMaterial);
    this.dqMesh = new THREE.Mesh(this.dqGeometry, this.dqMaterial);
    this.lbsMesh.layers.set(LBS_LAYER);
    this.dqMesh.layers.set(DQ_LAYER);
    this.lbsMesh.frustumCulled = false;
    this.dqMesh.frustumCulled = false;
    meshes.add(this.lbsMesh, this.dqMesh);

    this.lbsWire = new THREE.Mesh(
      this.lbsGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffcf9b,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.dqWire = new THREE.Mesh(
      this.dqGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xa7ffe0,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.lbsWire.layers.set(LBS_LAYER);
    this.dqWire.layers.set(DQ_LAYER);
    this.lbsWire.frustumCulled = false;
    this.dqWire.frustumCulled = false;
    this.lbsWire.visible = false;
    this.dqWire.visible = false;
    meshes.add(this.lbsWire, this.dqWire);
    this.scene.add(meshes);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 2.08);
    this.clipMaterials = [
      this.lbsMaterial,
      this.dqMaterial,
      this.lbsWire.material,
      this.dqWire.material,
    ];
  }

  setupRings() {
    this.ringLines = [];
    const modes = [
      ["lbs", LBS_LAYER, this.lbsGeometry],
      ["dq", DQ_LAYER, this.dqGeometry],
    ];
    for (const animation of ["wrist", "elbow"]) {
      const slices = this.meta.slices[animation];
      const primary = slices[Math.floor(slices.length / 2)];
      for (const [mode, layer] of modes) {
        for (const ring of slices) {
          const geometry = new THREE.BufferGeometry();
          const attribute = new THREE.BufferAttribute(
            new Float32Array(this.meta.segments * 3),
            3,
          );
          attribute.setUsage(THREE.DynamicDrawUsage);
          geometry.setAttribute("position", attribute);
          const material = new THREE.LineBasicMaterial({
            color: ring === primary ? 0x8fc6ff : 0x5d87ae,
            transparent: true,
            opacity: ring === primary ? 0.95 : 0.34,
            depthWrite: false,
          });
          const line = new THREE.LineLoop(geometry, material);
          line.layers.set(layer);
          line.frustumCulled = false;
          line.userData = { animation, mode, ring, primary: ring === primary };
          line.visible =
            this.ringsVisible && animation === this.animation;
          this.scene.add(line);
          this.ringLines.push(line);
        }
      }
    }
  }

  setupSkeleton() {
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(
      new Float32Array((this.bones.length - 1) * 6),
      3,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute);
    this.boneLine = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x79b7ff,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
    );
    this.boneLine.layers.enable(LBS_LAYER);
    this.boneLine.layers.enable(DQ_LAYER);
    this.boneLine.frustumCulled = false;
    this.scene.add(this.boneLine);

    const jointGeometry = new THREE.SphereGeometry(0.032, 14, 10);
    const jointMaterial = new THREE.MeshBasicMaterial({
      color: 0x9bc8ff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.jointMeshes = this.bones.map(() => {
      const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
      mesh.layers.enable(LBS_LAYER);
      mesh.layers.enable(DQ_LAYER);
      this.scene.add(mesh);
      return mesh;
    });
  }

  setupAnimations() {
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of this.gltf.animations) {
      const key = clip.name.toLowerCase().includes("wrist")
        ? "wrist"
        : clip.name.toLowerCase().includes("elbow")
          ? "elbow"
          : null;
      if (key) this.actions[key] = this.mixer.clipAction(clip);
    }
    this.restPose = this.bones.map((bone) => ({
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
    }));
    this.activeAction = null;
    this.setAnimation(this.animation);
  }

  resetRig() {
    this.bones.forEach((bone, index) => {
      bone.position.copy(this.restPose[index].position);
      bone.quaternion.copy(this.restPose[index].quaternion);
      bone.scale.set(1, 1, 1);
    });
    this.root.updateMatrixWorld(true);
  }

  setAnimation(name) {
    if (!this.actions[name]) return;
    this.animation = name;
    this.resetRig();
    if (this.activeAction) this.activeAction.stop();
    this.mixer.stopAllAction();
    this.activeAction = this.actions[name];
    this.activeAction.reset();
    this.activeAction.play();
    this.mixer.setTime(this.time);
    this.ringLines.forEach((line) => {
      line.visible =
        this.ringsVisible && line.userData.animation === this.animation;
    });
    if (this.activeView === "axis") this.applyAxisFocus();
  }

  setTime(time) {
    this.time = THREE.MathUtils.clamp(time, 0, 4);
    this.mixer.setTime(this.time);
  }

  setPlaying(playing) {
    this.playing = playing;
  }

  setScaleStress(enabled) {
    this.scaleStress = enabled;
  }

  setSkeletonVisible(visible) {
    this.skeletonVisible = visible;
    this.boneLine.visible = visible;
    this.jointMeshes.forEach((joint) => {
      joint.visible = visible;
    });
  }

  setRingsVisible(visible) {
    this.ringsVisible = visible;
    this.ringLines.forEach((line) => {
      line.visible = visible && line.userData.animation === this.animation;
    });
  }

  setWireVisible(visible) {
    this.wireVisible = visible;
    this.lbsWire.visible = visible;
    this.dqWire.visible = visible;
  }

  update(deltaSeconds) {
    if (this.playing) {
      this.time = (this.time + deltaSeconds) % 4;
    }
    this.mixer.setTime(this.time);
    if (this.forearm) {
      if (this.scaleStress) {
        this.forearm.scale.set(1, 1.38, 0.72);
      } else {
        this.forearm.scale.set(1, 1, 1);
      }
    }
    this.root.updateMatrixWorld(true);

    this.bones.forEach((bone, index) => {
      this.matrix.multiplyMatrices(bone.matrixWorld, this.skeleton.boneInverses[index]);
      this.skinMatrices.set(this.matrix.elements, index * 16);
    });
    const result = this.evaluator.evaluate(this.skinMatrices, {
      scaleCompensation: true,
    });

    this.applyPositions(this.lbsGeometry, result.lbs);
    this.applyPositions(this.dqGeometry, result.dq);
    this.updateRings(result);
    this.updateSkeleton();

    const wrist = Math.abs(
      (2 * Math.atan2(this.hand.quaternion.x, this.hand.quaternion.w) * 180) /
        Math.PI,
    );
    const elbow = Math.abs(
      (2 * Math.atan2(this.forearm.quaternion.z, this.forearm.quaternion.w) * 180) /
        Math.PI,
    );

    return {
      ...result,
      bindPositions: this.evaluator.bindPositions,
      angles: { wrist, elbow },
      time: this.time,
      scaleStress: this.scaleStress,
    };
  }

  applyPositions(geometry, positions) {
    const position = geometry.attributes.position;
    position.array.set(positions);
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.attributes.normal.needsUpdate = true;
  }

  updateRings(result) {
    for (const line of this.ringLines) {
      if (!line.visible) continue;
      const source = line.userData.mode === "lbs" ? result.lbs : result.dq;
      const start = this.meta.ringStarts[line.userData.ring];
      const target = line.geometry.attributes.position;
      for (let segment = 0; segment < this.meta.segments; segment += 1) {
        const sourceOffset = (start + segment) * 3;
        target.array[segment * 3] = source[sourceOffset];
        target.array[segment * 3 + 1] = source[sourceOffset + 1];
        target.array[segment * 3 + 2] = source[sourceOffset + 2];
      }
      target.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  updateSkeleton() {
    const positions = [];
    const worldPosition = new THREE.Vector3();
    for (const bone of this.bones) {
      bone.getWorldPosition(worldPosition);
      positions.push(worldPosition.clone());
    }
    const lineAttribute = this.boneLine.geometry.attributes.position;
    for (let index = 0; index < positions.length - 1; index += 1) {
      const current = positions[index];
      const next = positions[index + 1];
      const offset = index * 6;
      lineAttribute.array[offset] = current.x;
      lineAttribute.array[offset + 1] = current.y;
      lineAttribute.array[offset + 2] = current.z;
      lineAttribute.array[offset + 3] = next.x;
      lineAttribute.array[offset + 4] = next.y;
      lineAttribute.array[offset + 5] = next.z;
    }
    lineAttribute.needsUpdate = true;
    this.boneLine.geometry.computeBoundingSphere();
    this.jointMeshes.forEach((joint, index) => {
      joint.position.copy(positions[index]);
    });
  }

  setView(name) {
    const preset = VIEW_PRESETS[name] ?? VIEW_PRESETS.perspective;
    this.cameraState.target.copy(preset.target);
    this.cameraState.distance = preset.distance;
    this.cameraState.azimuth = preset.azimuth;
    this.cameraState.polar = preset.polar;
    this.activeView = name;
    this.applyAxisFocus();
  }

  applyAxisFocus() {
    const slices = this.meta.slices[this.animation];
    const primaryRing = slices[Math.floor(slices.length / 2)];
    const clipX = this.meta.stationX[primaryRing];
    this.clipPlane.constant = clipX;
    if (this.activeView === "axis") {
      this.cameraState.target.set(clipX, 1.35, 0);
      this.cameraState.distance = 5.4;
      this.cameraState.azimuth = Math.PI / 2;
      this.cameraState.polar = Math.PI / 2;
    }
    const planes = this.activeView === "axis" ? [this.clipPlane] : [];
    this.clipMaterials.forEach((material) => {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
  }

  updateCameras() {
    const halfWidth = this.width / 2;
    const state = this.cameraState;
    const sinPolar = Math.sin(state.polar);
    const aspect = halfWidth / this.height;
    const distanceScale = aspect < 0.48 ? Math.max(1, 0.6 / aspect) : 1;
    const effectiveDistance = state.distance * distanceScale;
    this.scene.fog.near = Math.max(7.4, effectiveDistance * 1.04);
    this.scene.fog.far = effectiveDistance + 6.5;
    const position = new THREE.Vector3(
      state.target.x + effectiveDistance * sinPolar * Math.sin(state.azimuth),
      state.target.y + effectiveDistance * Math.cos(state.polar),
      state.target.z + effectiveDistance * sinPolar * Math.cos(state.azimuth),
    );
    for (const camera of [this.leftCamera, this.rightCamera]) {
      camera.aspect = aspect;
      camera.position.copy(position);
      camera.lookAt(state.target);
      camera.updateProjectionMatrix();
    }
  }

  render() {
    this.resize();
    this.updateCameras();
    const width = this.width;
    const height = this.height;
    const half = Math.floor(width / 2);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(0, 0, half, height);
    this.renderer.setScissor(0, 0, half, height);
    this.renderer.render(this.scene, this.leftCamera);
    this.renderer.setViewport(half, 0, width - half, height);
    this.renderer.setScissor(half, 0, width - half, height);
    this.renderer.render(this.scene, this.rightCamera);
    this.renderer.setScissorTest(false);
  }

  bindPointerControls() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.cameraState.azimuth -= deltaX * 0.006;
      this.cameraState.polar = THREE.MathUtils.clamp(
        this.cameraState.polar - deltaY * 0.006,
        0.22,
        Math.PI - 0.22,
      );
    });
    const stopDragging = () => {
      dragging = false;
    };
    this.canvas.addEventListener("pointerup", stopDragging);
    this.canvas.addEventListener("pointercancel", stopDragging);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.cameraState.distance = THREE.MathUtils.clamp(
          this.cameraState.distance * Math.exp(event.deltaY * 0.0008),
          3.2,
          13,
        );
      },
      { passive: false },
    );
  }
}
