import { buildScene, CAMERA_STATIONS, VIEW_CONFIG, clonePose } from "./scene.js";
import { createAnalyzer } from "./visibility.js";
import {
  depthQuantization,
  formatDistance,
  formatScientific,
  mat4,
  offsetFailureDistance,
  vec3
} from "./math.js";
import { ViewerRenderer } from "./renderer.js";

const canvas = document.querySelector("#view");
const loading = document.querySelector("#loading");
const gpuBadge = document.querySelector("#gpu-badge");
const cameraReadout = document.querySelector("#camera-readout");
const stationList = document.querySelector("#station-list");
const stationTitle = document.querySelector("#station-title");
const stationIndex = document.querySelector("#station-index");
const pathStatus = document.querySelector("#path-status");
const pathResults = document.querySelector("#path-results");
const splitLabels = document.querySelector("#split-labels");
const offsetRange = document.querySelector("#offset-range");
const toleranceRange = document.querySelector("#tolerance-range");
const offsetValue = document.querySelector("#offset-value");
const toleranceValue = document.querySelector("#tolerance-value");
const analysisTime = document.querySelector("#analysis-time");
const sampleCount = document.querySelector("#sample-count");
const tourButton = document.querySelector("#tour-button");

const solid = buildScene();
const analyzer = createAnalyzer(solid, VIEW_CONFIG);
const state = {
  mode: "split",
  offset: Number(offsetRange.value),
  tolerance: Number(toleranceRange.value),
  camera: clonePose(CAMERA_STATIONS[0]),
  station: 0,
  lastResult: null,
  pathResults: new Map(),
  analysisTimer: 0,
  tour: null,
  dirty: true
};

let renderer;
try {
  renderer = new ViewerRenderer(canvas);
  renderer.setScene(solid);
  const info = renderer.getInfo();
  gpuBadge.textContent = `WebGL2 · ${shortRenderer(info.renderer)}`;
  loading.classList.add("hidden");
} catch (error) {
  loading.innerHTML = `<strong>${escapeText(error.message)}</strong>`;
  gpuBadge.textContent = "WebGL2 初始化失败";
  throw error;
}

const modeDescriptions = {
  offset: "投影前将边线向相机偏移，再用严格深度测试判定。偏移过大会让薄片背边漏出。",
  depth: "不移动边线，逐像素与实体深度纹理比较；容差吸收深度量化误差。",
  split: "左半屏使用投影偏移，右半屏使用深度相容；中线两侧使用完全相同的相机。"
};

document.querySelectorAll("#mode-control button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
offsetRange.addEventListener("input", () => {
  state.offset = Number(offsetRange.value);
  offsetValue.textContent = `${state.offset.toFixed(3)} u`;
  scheduleAnalysis();
});
toleranceRange.addEventListener("input", () => {
  state.tolerance = Number(toleranceRange.value);
  toleranceValue.textContent = formatScientific(state.tolerance);
  scheduleAnalysis();
});
tourButton.addEventListener("click", () => {
  if (state.tour) stopTour();
  else startTour();
});
document.querySelector("#prev-station").addEventListener("click", () => {
  stopTour();
  setStation((state.station ?? 0) > 0 ? state.station - 1 : CAMERA_STATIONS.length - 1);
});
document.querySelector("#next-station").addEventListener("click", () => {
  stopTour();
  setStation(state.station === null ? 0 : (state.station + 1) % CAMERA_STATIONS.length);
});

createStationButtons();
bindCameraControls();
applyMode();
resizeRenderer();
setStation(0, { immediate: true });
requestAnimationFrame(frame);

const requestedStation = new URLSearchParams(location.search).get("station");
if (requestedStation) {
  const index = CAMERA_STATIONS.findIndex((station) => station.id === requestedStation);
  if (index >= 0) setStation(index, { immediate: true });
}
const requestedMode = new URLSearchParams(location.search).get("mode");
if (["offset", "depth", "split"].includes(requestedMode)) setMode(requestedMode);

window.__viewerReady = true;
window.__viewer = {
  setStation: (index) => setStation(index, { immediate: true }),
  setMode,
  analyze: analyzeNow,
  getState: () => ({
    station: state.station,
    mode: state.mode,
    offset: state.offset,
    tolerance: state.tolerance,
    result: state.lastResult
  })
};

function createStationButtons() {
  for (const [index, station] of CAMERA_STATIONS.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "station-button";
    button.dataset.index = String(index);
    button.innerHTML = `${escapeText(station.name)}<span>${station.code}</span>`;
    button.addEventListener("click", () => {
      stopTour();
      setStation(index);
    });
    stationList.append(button);
  }
}

function setMode(mode) {
  if (!modeDescriptions[mode]) return;
  state.mode = mode;
  applyMode();
}

function applyMode() {
  document.querySelectorAll("#mode-control button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  document.querySelector("#mode-description").textContent = modeDescriptions[state.mode];
  splitLabels.hidden = state.mode !== "split";
  canvas.parentElement.classList.toggle("split", state.mode === "split");
}

function setStation(index, options = {}) {
  const station = CAMERA_STATIONS[index];
  if (!station) return;
  state.station = index;
  state.camera = clonePose(station);
  updateStationUi();
  if (options.immediate) analyzeNow();
  else scheduleAnalysis();
}

function updateStationUi() {
  document.querySelectorAll(".station-button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.index) === state.station);
  });
  if (state.station === null) {
    stationTitle.textContent = "自由视角";
    stationIndex.textContent = "手动";
    return;
  }
  const station = CAMERA_STATIONS[state.station];
  stationTitle.textContent = station.name;
  stationIndex.textContent = `${station.code} / ${String(CAMERA_STATIONS.length).padStart(2, "0")}`;
}

function scheduleAnalysis() {
  clearTimeout(state.analysisTimer);
  state.analysisTimer = window.setTimeout(analyzeNow, 110);
}

function analyzeNow() {
  clearTimeout(state.analysisTimer);
  const start = performance.now();
  const result = analyzer.analyze(state.camera, {
    offset: state.offset,
    tolerance: state.tolerance,
    aspect: renderer.width / renderer.height
  });
  const elapsed = performance.now() - start;
  state.lastResult = result;
  analysisTime.textContent = `${elapsed.toFixed(1)} ms`;
  sampleCount.textContent = `${solid.edges.length} 条边 · ${result.sampleCount} 采样`;
  updateDiagnostics(result, elapsed);
  if (state.station !== null) {
    state.pathResults.set(state.station, result);
    updatePathTable();
  }
  return result;
}

function updateDiagnostics(result) {
  setMetric("offset-leaks", countText(result.offsetThinLeak, result.thinBackHidden), "bad");
  setMetric("depth-leaks", countText(result.depthThinLeak, result.thinBackHidden), "good");
  setMetric("offset-far", farText(result, "offset"), "bad");
  setMetric("depth-far", farText(result, "depth"), "good");
  setText("offset-missed", result.offsetMissed);
  setText("depth-missed", result.depthMissed);
  setText("offset-bleed", result.offsetBleed);
  setText("depth-bleed", result.depthBleed);
  setText("offset-coplanar", percentText(result.offsetCoplanarRate, result.coplanarTotal));
  setText("depth-coplanar", percentText(result.depthCoplanarRate, result.coplanarTotal));
  setText("offset-external", countText(result.offsetExternalLeak, result.externalHidden));
  setText("depth-external", countText(result.depthExternalLeak, result.externalHidden));

  const limit = offsetFailureDistance(state.offset, VIEW_CONFIG.near, VIEW_CONFIG.far, VIEW_CONFIG.depthBits);
  const quantization = depthQuantization(VIEW_CONFIG.depthBits);
  document.querySelector("#depth-note").textContent =
    `24 位深度步长 ${formatScientific(quantization)}；当前偏移的解析失效距离约 ${formatDistance(limit)} u。` +
    ` 距离更远时，${state.offset.toFixed(3)} u 的前移已不足一个深度级。`;
  const finText = result.thinBackHidden
    ? `薄片背边采样 ${result.thinBackHidden} 个：偏移泄漏 ${result.offsetThinLeak}，深度相容泄漏 ${result.depthThinLeak}。`
    : "当前视角未看到薄片背边。";
  const farTextValue = result.offsetFarInView
    ? `远场参考可见边在偏移法中的首个失效率 >50% 距离：${formatDistance(result.offsetFar)} u。`
    : "当前视角未看到远场门架，切换到“远场门架”检查消失距离。";
  document.querySelector("#analysis-note").textContent = `${finText} ${farTextValue}`;
}

function updatePathTable() {
  const rows = CAMERA_STATIONS.map((station, index) => {
    const result = state.pathResults.get(index);
    const current = index === state.station ? " class=\"current\"" : "";
    if (!result) {
      return `<tr${current}><td>${station.code} ${escapeText(station.name)}</td><td>—</td><td>—</td><td>—</td></tr>`;
    }
    const leaks = `${result.offsetThinLeak} / ${result.depthThinLeak}`;
    return `<tr${current}><td>${station.code} ${escapeText(station.name)}</td>` +
      `<td>${result.offsetMissed}</td><td>${result.depthMissed}</td><td>${leaks}</td></tr>`;
  });
  pathResults.innerHTML = rows.join("");
}

function setMetric(id, value, className) {
  const element = document.querySelector(`#${id}`);
  element.textContent = value;
  element.parentElement.classList.remove("bad", "good");
  element.parentElement.classList.add(className);
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function countText(value, total) {
  return total > 0 ? `${value} / ${total}` : "—";
}

function percentText(rate, total) {
  return total > 0 ? `${(rate * 100).toFixed(1)}%` : "—";
}

function farText(result, method) {
  if (!result.offsetFarInView) return "视野外";
  const value = method === "offset" ? result.offsetFar : result.depthFar;
  return formatDistance(value);
}

function shortRenderer(name) {
  if (/swiftshader/i.test(name)) return "SwiftShader";
  if (/llvmpipe/i.test(name)) return "llvmpipe";
  return name.length > 22 ? `${name.slice(0, 22)}…` : name;
}

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
  }[character]));
}

function bindCameraControls() {
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    stopTour();
    enginePause();
    canvas.setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      y: event.clientY,
      mode: event.button === 2 || event.shiftKey ? "pan" : "orbit"
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.mode === "pan") panCamera(dx, dy);
    else orbitCamera(dx, dy);
  });
  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    scheduleAnalysis();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    stopTour();
    enginePause();
    const offset = vec3.sub(state.camera.eye, state.camera.target);
    const radius = vec3.length(offset);
    const nextRadius = clampNumber(radius * Math.exp(event.deltaY * 0.0012), 0.8, 6000);
    state.camera.eye = vec3.add(state.camera.target, vec3.scale(offset, nextRadius / radius));
    state.dirty = true;
    scheduleAnalysis();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => {
    stopTour();
    setStation(state.station ?? 0, { immediate: true });
  });
}

function orbitCamera(dx, dy) {
  const offset = vec3.sub(state.camera.eye, state.camera.target);
  const radius = Math.max(vec3.length(offset), 0.01);
  let yaw = Math.atan2(offset[0], offset[2]);
  let pitch = Math.asin(clampNumber(offset[1] / radius, -1, 1));
  yaw -= dx * 0.006;
  pitch = clampNumber(pitch - dy * 0.006, -1.47, 1.47);
  const horizontal = Math.cos(pitch) * radius;
  state.camera.eye = [
    state.camera.target[0] + Math.sin(yaw) * horizontal,
    state.camera.target[1] + Math.sin(pitch) * radius,
    state.camera.target[2] + Math.cos(yaw) * horizontal
  ];
  markFreeCamera();
}

function panCamera(dx, dy) {
  const forward = vec3.normalize(vec3.sub(state.camera.target, state.camera.eye));
  const right = vec3.normalize(vec3.cross(forward, state.camera.up));
  const up = vec3.normalize(vec3.cross(right, forward));
  const distance = vec3.length(vec3.sub(state.camera.target, state.camera.eye));
  const scale = distance * 0.0016;
  const shift = vec3.add(vec3.scale(right, -dx * scale), vec3.scale(up, dy * scale));
  state.camera.eye = vec3.add(state.camera.eye, shift);
  state.camera.target = vec3.add(state.camera.target, shift);
  markFreeCamera();
}

function markFreeCamera() {
  state.station = null;
  state.dirty = true;
  updateStationUi();
  scheduleAnalysis();
}

function enginePause() {
  state.dirty = true;
}

function startTour() {
  state.tour = {
    index: 0,
    phase: "hold",
    phaseStart: performance.now(),
    holdDuration: 900,
    moveDuration: 1650,
    from: clonePose(state.camera)
  };
  setStation(0, { immediate: true });
  tourButton.textContent = "停止巡线";
  tourButton.classList.add("running");
  pathStatus.textContent = "自动巡线中 · 每站停留采样";
}

function stopTour() {
  if (!state.tour) return;
  state.tour = null;
  tourButton.textContent = "自动巡线";
  tourButton.classList.remove("running");
  pathStatus.textContent = "拖动旋转 · 滚轮缩放 · 双击重置";
}

function updateTour(now) {
  if (!state.tour) return;
  const tour = state.tour;
  const elapsed = now - tour.phaseStart;
  if (tour.phase === "hold") {
    state.camera = clonePose(CAMERA_STATIONS[tour.index]);
    state.station = tour.index;
    updateStationUi();
    if (elapsed >= tour.holdDuration) {
      if (tour.index >= CAMERA_STATIONS.length - 1) {
        stopTour();
        pathStatus.textContent = "巡线完成 · 路径记录已更新";
        return;
      }
      tour.phase = "move";
      tour.phaseStart = now;
      tour.from = clonePose(state.camera);
      tour.to = CAMERA_STATIONS[tour.index + 1];
    }
    return;
  }

  const rawT = Math.min(1, elapsed / tour.moveDuration);
  const t = smoothNumber(rawT);
  state.camera.eye = vec3.lerp(tour.from.eye, tour.to.eye, t);
  state.camera.target = vec3.lerp(tour.from.target, tour.to.target, t);
  state.camera.up = vec3.lerp(tour.from.up, tour.to.up, t);
  state.station = null;
  state.dirty = true;
  if (rawT >= 1) {
    tour.index += 1;
    tour.phase = "hold";
    tour.phaseStart = now;
    setStation(tour.index, { immediate: true });
  }
}

function frame(now) {
  updateTour(now);
  resizeRenderer();
  const projection = mat4.perspective(
    VIEW_CONFIG.fovY,
    renderer.width / renderer.height,
    VIEW_CONFIG.near,
    VIEW_CONFIG.far
  );
  const view = mat4.lookAt(state.camera.eye, state.camera.target, state.camera.up);
  const viewProjection = mat4.multiply(projection, view);
  renderer.render({
    viewProjection,
    eye: state.camera.eye,
    offset: state.offset,
    tolerance: state.tolerance,
    mode: state.mode,
    depthBits: VIEW_CONFIG.depthBits,
    near: VIEW_CONFIG.near,
    far: VIEW_CONFIG.far
  });
  updateReadout();
  requestAnimationFrame(frame);
}

let lastReadout = 0;
function updateReadout() {
  const now = performance.now();
  if (now - lastReadout < 100) return;
  lastReadout = now;
  const distance = vec3.length(vec3.sub(state.camera.eye, state.camera.target));
  cameraReadout.textContent =
    `EYE ${state.camera.eye.map((value) => value.toFixed(1)).join(" ")}` +
    ` · D ${distance.toFixed(1)} u`;
}

function resizeRenderer() {
  const beforeWidth = renderer.width;
  const beforeHeight = renderer.height;
  renderer.resize();
  if (beforeWidth !== renderer.width || beforeHeight !== renderer.height) {
    state.dirty = true;
    scheduleAnalysis();
  }
}

function clampNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothNumber(t) {
  const x = clampNumber(t, 0, 1);
  return x * x * (3 - 2 * x);
}
