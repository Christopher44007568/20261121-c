import * as THREE from "three";
import "./style.css";
import { createRockTextures } from "./textures.js";
import { createTriplanarMaterial } from "./triplanar.js";
import { addTestModels, createLab } from "./scene.js";

const canvas = document.querySelector("#viewport");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const textures = createRockTextures(renderer);
const material = createTriplanarMaterial(textures);
const { scene, camera, controls } = createLab(renderer, material);
const lab = addTestModels(scene, material);
const labelsRoot = document.querySelector("#labels");
const readout = document.querySelector("#view-readout");

const state = {
  weights: { x: 1, y: 1, z: 1 },
  contrast: 6,
  tileSize: 1,
  normalStrength: 1,
  lightAzimuth: -38,
  lightElevation: 36,
  sweep: false,
  mode: "lit",
  preset: "overview",
};

const defaults = structuredClone(state);
const axisMeta = [
  { key: "x", label: "X · YZ", color: "var(--x)" },
  { key: "y", label: "Y · XZ", color: "var(--y)" },
  { key: "z", label: "Z · XY", color: "var(--z)" },
];

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function createWeightControls() {
  const root = document.querySelector("#weight-controls");
  for (const axis of axisMeta) {
    const row = document.createElement("label");
    row.className = "weight-row";
    row.htmlFor = `weight-${axis.key}`;
    row.innerHTML = `
      <span class="weight-name"><i style="background:${axis.color}"></i>${axis.label}</span>
      <input id="weight-${axis.key}" type="range" min="0" max="1.5" step="0.05" value="1" />
      <output>1.00</output>
    `;
    const input = row.querySelector("input");
    const output = row.querySelector("output");
    setRangeFill(input);
    input.addEventListener("input", () => {
      state.weights[axis.key] = Number(input.value);
      output.value = Number(input.value).toFixed(2);
      setRangeFill(input);
      updateWeights();
    });
    root.append(row);
  }
}

function updateWeights() {
  material.uniforms.uBlendWeights.value.set(
    state.weights.x,
    state.weights.y,
    state.weights.z,
  );
}

function updateLight() {
  const azimuth = THREE.MathUtils.degToRad(state.lightAzimuth);
  const elevation = THREE.MathUtils.degToRad(state.lightElevation);
  const direction = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
  material.uniforms.uLightDirection.value.copy(direction);
}

const contrastInput = document.querySelector("#contrast");
const contrastValue = document.querySelector("#contrast-value");
contrastInput.addEventListener("input", () => {
  state.contrast = Number(contrastInput.value);
  contrastValue.value = state.contrast.toFixed(1);
  material.uniforms.uBlendContrast.value = state.contrast;
  setRangeFill(contrastInput);
});

const tileInput = document.querySelector("#tile-size");
const tileValue = document.querySelector("#tile-size-value");
tileInput.addEventListener("input", () => {
  state.tileSize = Number(tileInput.value);
  tileValue.value = `${state.tileSize.toFixed(2)} m`;
  material.uniforms.uTileSize.value = state.tileSize;
  setRangeFill(tileInput);
});

const normalStrengthInput = document.querySelector("#normal-strength");
const normalStrengthValue = document.querySelector("#normal-strength-value");
normalStrengthInput.addEventListener("input", () => {
  state.normalStrength = Number(normalStrengthInput.value);
  normalStrengthValue.value = `${state.normalStrength.toFixed(2)}×`;
  material.uniforms.uNormalStrength.value = state.normalStrength;
  setRangeFill(normalStrengthInput);
});

const flipGInput = document.querySelector("#flip-g");
flipGInput.addEventListener("change", () => {
  material.uniforms.uFlipNormalG.value = flipGInput.checked ? -1 : 1;
});

const flipXInput = document.querySelector("#flip-x");
flipXInput.addEventListener("change", () => {
  material.uniforms.uFlipNormalX.value = flipXInput.checked ? -1 : 1;
});

const modeButtons = [...document.querySelectorAll("#view-modes button")];
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    material.uniforms.uViewMode.value = { lit: 0, albedo: 1, normal: 2, weights: 3 }[
      state.mode
    ];
    for (const candidate of modeButtons) {
      candidate.classList.toggle("active", candidate === button);
    }
  });
}

const azimuthInput = document.querySelector("#light-azimuth");
const azimuthValue = document.querySelector("#light-azimuth-value");
function formatDegrees(value) {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}${Math.abs(rounded)}°`;
}
azimuthInput.addEventListener("input", () => {
  state.lightAzimuth = Number(azimuthInput.value);
  azimuthValue.value = formatDegrees(state.lightAzimuth);
  setRangeFill(azimuthInput);
  updateLight();
});

const elevationInput = document.querySelector("#light-elevation");
const elevationValue = document.querySelector("#light-elevation-value");
elevationInput.addEventListener("input", () => {
  state.lightElevation = Number(elevationInput.value);
  elevationValue.value = formatDegrees(state.lightElevation);
  setRangeFill(elevationInput);
  updateLight();
});

const sweepInput = document.querySelector("#light-sweep");
sweepInput.addEventListener("change", () => {
  state.sweep = sweepInput.checked;
});

const presetButtons = [...document.querySelectorAll("#camera-presets button")];
const labelElements = lab.labels.map((label) => {
  const element = document.createElement("span");
  element.className = `model-label ${label.className ?? ""}`.trim();
  element.innerHTML = `${label.text}<small>${label.note}</small>`;
  labelsRoot.append(element);
  label.element = element;
  return label;
});

let cameraTween = null;
function moveCamera(presetName, immediate = false) {
  const preset = lab.presets[presetName];
  state.preset = presetName;
  for (const button of presetButtons) {
    button.classList.toggle("active", button.dataset.preset === presetName);
  }
  readout.querySelector("strong").textContent = preset.label;
  readout.querySelector("span:last-child").textContent = preset.detail;

  if (immediate) {
    camera.position.copy(preset.position);
    controls.target.copy(preset.target);
    controls.update();
    return;
  }

  cameraTween = {
    start: performance.now(),
    duration: 900,
    fromPosition: camera.position.clone(),
    toPosition: preset.position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: preset.target.clone(),
  };
  controls.enabled = false;
}

for (const button of presetButtons) {
  button.addEventListener("click", () => moveCamera(button.dataset.preset));
}
controls.addEventListener("start", () => {
  cameraTween = null;
  controls.enabled = true;
});

function updateCameraTween(now) {
  if (!cameraTween) return;
  const linear = Math.min(1, (now - cameraTween.start) / cameraTween.duration);
  const eased = 1 - Math.pow(1 - linear, 3);
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  controls.update();

  if (linear >= 1) {
    cameraTween = null;
    controls.enabled = true;
  }
}

const projection = new THREE.Vector3();
function updateLabels() {
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  for (const label of labelElements) {
    projection.copy(label.position).project(camera);
    const inScope = !label.scopes || label.scopes.includes(state.preset);
    const screenX = (projection.x * 0.5 + 0.5) * width;
    const screenY = (-projection.y * 0.5 + 0.5) * height;
    const underPanel = width > 900 && screenX < 330 && screenY < 825;
    const visible =
      inScope &&
      !underPanel &&
      projection.z > -1 &&
      projection.z < 1 &&
      Math.abs(projection.x) < 1.05 &&
      Math.abs(projection.y) < 1.05;
    label.element.style.opacity = visible ? "1" : "0";
    label.element.style.left = `${screenX}px`;
    label.element.style.top = `${screenY}px`;
  }
}

function syncRange(input, output, value, formatter) {
  input.value = value;
  output.value = formatter(value);
  setRangeFill(input);
}

function resetControls() {
  state.weights = { ...defaults.weights };
  state.contrast = defaults.contrast;
  state.tileSize = defaults.tileSize;
  state.normalStrength = defaults.normalStrength;
  state.lightAzimuth = defaults.lightAzimuth;
  state.lightElevation = defaults.lightElevation;
  state.sweep = false;
  state.mode = "lit";

  for (const axis of axisMeta) {
    const input = document.querySelector(`#weight-${axis.key}`);
    const output = input.closest(".weight-row").querySelector("output");
    syncRange(input, output, state.weights[axis.key], (value) => value.toFixed(2));
  }
  syncRange(contrastInput, contrastValue, state.contrast, (value) => value.toFixed(1));
  syncRange(tileInput, tileValue, state.tileSize, (value) => `${value.toFixed(2)} m`);
  syncRange(
    normalStrengthInput,
    normalStrengthValue,
    state.normalStrength,
    (value) => `${value.toFixed(2)}×`,
  );
  syncRange(azimuthInput, azimuthValue, state.lightAzimuth, formatDegrees);
  syncRange(elevationInput, elevationValue, state.lightElevation, formatDegrees);

  flipGInput.checked = false;
  flipXInput.checked = false;
  sweepInput.checked = false;
  material.uniforms.uFlipNormalG.value = 1;
  material.uniforms.uFlipNormalX.value = 1;
  material.uniforms.uViewMode.value = 0;
  for (const button of modeButtons) {
    button.classList.toggle("active", button.dataset.mode === "lit");
  }
  updateWeights();
  material.uniforms.uBlendContrast.value = state.contrast;
  material.uniforms.uTileSize.value = state.tileSize;
  material.uniforms.uNormalStrength.value = state.normalStrength;
  updateLight();
  moveCamera("overview");
}

document.querySelector("#reset").addEventListener("click", resetControls);
document.querySelector("#normalize-weights").addEventListener("click", () => {
  state.weights = { x: 1, y: 1, z: 1 };
  for (const axis of axisMeta) {
    const input = document.querySelector(`#weight-${axis.key}`);
    const output = input.closest(".weight-row").querySelector("output");
    syncRange(input, output, 1, (value) => value.toFixed(2));
  }
  updateWeights();
});

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

new ResizeObserver(resize).observe(canvas);
window.addEventListener("resize", resize);

for (const input of [
  contrastInput,
  tileInput,
  normalStrengthInput,
  azimuthInput,
  elevationInput,
]) {
  setRangeFill(input);
}

createWeightControls();
updateWeights();
updateLight();
moveCamera("overview", true);
resize();

const query = new URLSearchParams(window.location.search);
if (query.has("mode")) {
  document.querySelector(`#view-modes [data-mode="${query.get("mode")}"]`)?.click();
}
if (query.has("preset")) {
  moveCamera(query.get("preset"), true);
}
if (query.has("azimuth")) {
  state.lightAzimuth = Number(query.get("azimuth"));
  syncRange(azimuthInput, azimuthValue, state.lightAzimuth, formatDegrees);
  updateLight();
}
if (query.has("elevation")) {
  state.lightElevation = Number(query.get("elevation"));
  syncRange(elevationInput, elevationValue, state.lightElevation, formatDegrees);
  updateLight();
}
if (query.has("tile")) {
  state.tileSize = Number(query.get("tile"));
  syncRange(tileInput, tileValue, state.tileSize, (value) => `${value.toFixed(2)} m`);
  material.uniforms.uTileSize.value = state.tileSize;
}

window.__TRIPLANAR_LAB__ = { state, material, scene, camera, controls, ...lab };

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const modeByKey = { "1": "lit", "2": "albedo", "3": "normal", "4": "weights" };
  const presetByKey = {
    q: "overview",
    w: "ceiling",
    e: "underside",
    r: "mirror",
  };
  if (modeByKey[event.key]) {
    document.querySelector(`#view-modes [data-mode="${modeByKey[event.key]}"]`).click();
  }
  if (presetByKey[event.key.toLowerCase()]) {
    moveCamera(presetByKey[event.key.toLowerCase()]);
  }
});

let lastFrame = performance.now();
function render(now) {
  const delta = Math.min(64, now - lastFrame);
  lastFrame = now;

  updateCameraTween(now);
  if (state.sweep) {
    const azimuth = -38 + Math.sin(now * 0.00052) * 112;
    state.lightAzimuth = azimuth;
    syncRange(azimuthInput, azimuthValue, azimuth, formatDegrees);
    updateLight();
  }

  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
