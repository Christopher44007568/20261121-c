import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAssembly } from "./model.js";

const MAX_PIXEL_RATIO = 2;
const CAMERA_PRESETS = {
  iso: {
    position: new THREE.Vector3(5.7, 4.35, 7.05),
    target: new THREE.Vector3(0, 0.02, 0),
  },
  front: {
    position: new THREE.Vector3(0.01, 1.65, 9.2),
    target: new THREE.Vector3(0, 0.05, 0),
  },
  top: {
    position: new THREE.Vector3(0.01, 9.4, 0.01),
    target: new THREE.Vector3(0, -0.02, 0),
  },
};

export class Viewer {
  constructor(container) {
    this.container = container;
    this.viewportListeners = new Set();
    this.cameraListeners = new Set();
    this.interactionMode = "select";
    this.cameraTween = null;
    this.lastPixelRatio = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "Three.js assembly viewport");
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0f10, 0.017);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.camera.position.copy(CAMERA_PRESETS.iso.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(CAMERA_PRESETS.iso.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.3;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.7;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener("change", () => this.emitCameraChange());

    this.setupEnvironment();
    this.setupLights();
    this.setupGround();

    this.assembly = createAssembly();
    this.modelRoot = new THREE.Group();
    this.modelRoot.rotation.y = -0.16;
    this.modelRoot.add(this.assembly.root);
    this.scene.add(this.modelRoot);

    this.outlineGroup = new THREE.Group();
    this.outlineGroup.name = "Selection outlines";
    this.scene.add(this.outlineGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate = this.animate.bind(this);
    this.renderer.setAnimationLoop(this.animate);
  }

  setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTexture = pmrem.fromScene(room, 0.045).texture;
    this.scene.environment = this.environmentTexture;
    room.dispose();
    pmrem.dispose();
  }

  setupLights() {
    const hemisphere = new THREE.HemisphereLight(0x9ac6bb, 0x15201f, 1.45);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffe5cf, 3.2);
    key.position.set(-4.8, 8.4, 6.3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6ba9ff, 2.35);
    rim.position.set(5.5, 3.2, -5.8);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0x61f3c7, 12, 9, 2.2);
    fill.position.set(-3.2, 1.6, 3.8);
    this.scene.add(fill);
  }

  setupGround() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9.5, 96),
      new THREE.MeshStandardMaterial({
        color: 0x0e1515,
        metalness: 0.32,
        roughness: 0.82,
        transparent: true,
        opacity: 0.93,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.56;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const polar = new THREE.PolarGridHelper(8.4, 12, 8, 96, 0x36554f, 0x1e302d);
    polar.position.y = -1.545;
    polar.material.transparent = true;
    polar.material.opacity = 0.29;
    polar.material.depthWrite = false;
    this.scene.add(polar);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.82, 4.84, 128),
      new THREE.MeshBasicMaterial({
        color: 0x4d8177,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.54;
    this.scene.add(ring);
  }

  animate(time) {
    if (this.cameraTween) {
      this.stepCameraTween(time);
    }

    const dpr = this.getTargetPixelRatio();
    if (Math.abs(dpr - this.lastPixelRatio) > 0.01) {
      this.resize();
    }

    this.controls.update();
    this.outlineGroup.children.forEach((line, index) => {
      line.material.opacity = 0.58 + Math.sin(time * 0.0045 + index * 0.43) * 0.18;
    });
    this.renderer.render(this.scene, this.camera);
  }

  getTargetPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = this.getTargetPixelRatio();
    if (
      width === this.lastWidth &&
      height === this.lastHeight &&
      Math.abs(pixelRatio - this.lastPixelRatio) < 0.01
    ) {
      return;
    }

    this.lastWidth = width;
    this.lastHeight = height;
    this.lastPixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, true);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.viewportListeners.forEach((listener) => listener(this.getViewportState()));
  }

  getViewportState() {
    const rect = this.container.getBoundingClientRect();
    const drawingBufferSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      drawingWidth: drawingBufferSize.x,
      drawingHeight: drawingBufferSize.y,
      pixelRatio: this.renderer.getPixelRatio(),
      devicePixelRatio: window.devicePixelRatio || 1,
      aspect: this.camera.aspect,
    };
  }

  getCameraState() {
    return {
      position: this.camera.position.toArray(),
      quaternion: this.camera.quaternion.toArray(),
      up: this.camera.up.toArray(),
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      target: this.controls.target.toArray(),
    };
  }

  setCameraState(state) {
    if (!state) return;
    this.cameraTween = null;
    this.camera.position.fromArray(state.position);
    this.camera.quaternion.fromArray(state.quaternion);
    this.camera.up.fromArray(state.up);
    this.camera.fov = state.fov;
    this.camera.near = state.near;
    this.camera.far = state.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.fromArray(state.target);
    this.controls.update();
    this.emitCameraChange();
  }

  flyToPreset(name) {
    const preset = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.iso;
    this.cameraTween = {
      startTime: performance.now(),
      duration: 620,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: preset.position.clone(),
      toTarget: preset.target.clone(),
    };
  }

  stepCameraTween(time) {
    const tween = this.cameraTween;
    const raw = Math.min(1, (time - tween.startTime) / tween.duration);
    const progress = 1 - Math.pow(1 - raw, 3);
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, progress);
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, progress);
    this.camera.lookAt(this.controls.target);
    if (raw >= 1) this.cameraTween = null;
    this.emitCameraChange();
  }

  setInteractionMode(mode) {
    this.interactionMode = mode;
    if (mode === "orbit") {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    } else {
      this.controls.mouseButtons.LEFT = null;
    }
    this.container.classList.toggle("is-orbiting", mode === "orbit");
  }

  setControlsEnabled(enabled) {
    this.controls.enabled = enabled;
  }

  getCameraSummary() {
    const target = this.controls.target;
    const relative = this.camera.position.clone().sub(target);
    const azimuth = THREE.MathUtils.radToDeg(Math.atan2(relative.x, relative.z));
    const elevation = THREE.MathUtils.radToDeg(
      Math.atan2(relative.y, Math.hypot(relative.x, relative.z)),
    );
    return `AZ ${formatAngle(azimuth)} / EL ${formatAngle(elevation)}`;
  }

  setSelectionDescriptors(descriptors) {
    while (this.outlineGroup.children.length) {
      const child = this.outlineGroup.children.pop();
      child.geometry?.dispose();
      child.material?.dispose();
    }

    const matrix = new THREE.Matrix4();
    const instanceMatrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const descriptor of descriptors) {
      const source = descriptor.sourceMesh;
      if (!source?.geometry) continue;
      source.geometry.computeBoundingBox();
      if (!source.geometry.boundingBox) continue;

      box.copy(source.geometry.boundingBox);
      if (Number.isInteger(descriptor.instanceIndex) && source.isInstancedMesh) {
        source.getMatrixAt(descriptor.instanceIndex, instanceMatrix);
        matrix.multiplyMatrices(source.matrixWorld, instanceMatrix);
      } else {
        matrix.copy(source.matrixWorld);
      }
      box.applyMatrix4(matrix);
      box.expandByScalar(0.012);

      const helper = new THREE.Box3Helper(
        box.clone(),
        new THREE.Color(descriptor.color || "#61f3c7"),
      );
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.7;
      helper.material.blending = THREE.AdditiveBlending;
      helper.renderOrder = 20;
      this.outlineGroup.add(helper);
    }
  }

  clearSelectionDescriptors() {
    this.setSelectionDescriptors([]);
  }

  onViewportChange(listener) {
    this.viewportListeners.add(listener);
    return () => this.viewportListeners.delete(listener);
  }

  onCameraChange(listener) {
    this.cameraListeners.add(listener);
    return () => this.cameraListeners.delete(listener);
  }

  emitCameraChange() {
    const summary = this.getCameraSummary();
    this.cameraListeners.forEach((listener) => listener(summary, this.getCameraState()));
  }
}

function formatAngle(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1).padStart(5, "0")}°`;
}
