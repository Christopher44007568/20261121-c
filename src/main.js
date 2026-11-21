import { PenumbraRenderer } from "./renderer.js";
import {
  DEFAULT_STATE,
  PROBE_COLORS,
  PROBE_Z,
  cameraRay,
  clamp,
  createCamera,
  measureContactEdge,
  measurePenumbra
} from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { ...DEFAULT_STATE };
const cameraState = {
  yaw: 0.58,
  pitch: 0.29,
  distance: 9.4,
  target: [0, 1.12, 0.08],
  fov: 50,
  aspect: 1
};
let camera = createCamera(cameraState);
let renderer = null;
let viewMode = 0;
let pendingReference = false;
let referenceRequestedAt = 0;
let lastSceneChange = performance.now();
let framesSinceReset = 0;
let measurement = [];
let measureTimer = 0;
let sweepTimer = 0;
let sweepBusy = false;
let lastCutAngle = 0;
let cutCount = 0;
let cutStartedAt = 0;
let pendingLatency = false;
let staleHistory = false;
let previousFrameTime = performance.now();
let lastStatsAt = 0;
let dragging = false;
let dragX = 0;
let dragY = 0;
let frameHandle = 0;
let resolutionWidth = 1;
let resolutionHeight = 1;
let referenceReadyAt = 0;
let forceReferenceOnce = false;
let sweepResults = null;

const els = {};

async function init() {
  cacheElements();
  bindControls();
  syncControls();
  scheduleMeasurement(true);
  updateReferenceState("STALE");
  updateHistoryPanel("normal");

  try {
    renderer = new PenumbraRenderer($("#gpuCanvas"));
    await renderer.init();
    $("#gpuStatus").classList.remove("error");
    $("#gpuStatus .status-copy").innerHTML = "WEBGPU <b>ACTIVE</b>";
    $("#gpuInfo").textContent = renderer.getInfo();
    $("#stageLoading").classList.add("hidden");
    $("#webgpuError").hidden = true;
    requestAnimationFrame(() => {
      $("#stageLoading").hidden = true;
    });
    frameHandle = requestAnimationFrame(renderFrame);
    setTimeout(() => runSweep(true), 850);
  } catch (error) {
    console.error(error);
    renderer = null;
    $("#gpuStatus").classList.add("error");
    $("#gpuStatus .status-copy").innerHTML = "WEBGPU <b>UNAVAILABLE</b>";
    $("#gpuInfo").textContent = "WEBGPU · ADAPTER UNAVAILABLE";
    $("#stageLoading").classList.add("hidden");
    $("#webgpuError").hidden = false;
    showToast(`WebGPU 初始化失败：${error.message}`, "warn");
  }
  window.__viewerReady = true;
  window.__penumbra = {
    getState: () => ({
      ...state,
      camera: { ...cameraState },
      viewMode,
      cutCount,
      lastCutAngle,
      staleHistory,
      referenceValid: Boolean(renderer?.referenceValid),
      measurement
    }),
    getDiagnostics: () => ({
      measurement: measurement.map(({ z, width, litEdge, darkEdge, halfEdge }) => ({
        z, width, litEdge, darkEdge, halfEdge
      })),
      sweep: sweepResults,
      cutCount,
      lastCutAngle,
      staleHistory,
      referenceValid: Boolean(renderer?.referenceValid),
      gpu: renderer?.getInfo() || null
    }),
    runSweep: () => runSweep(false),
    cameraCut,
    resetHistory
  };
}

function cacheElements() {
  const ids = [
    "gpuStatus", "frameTime", "sampleCount", "gpuInfo", "lightWidth", "lightDepth",
    "boardGap", "boardOffset", "boardWidth", "historyAlpha", "lightWidthOut",
    "lightDepthOut", "boardGapOut", "boardOffsetOut", "boardWidthOut",
    "historyAlphaOut", "lightPreview", "sampleRate", "resetHistory", "profileChart",
    "probeGrid", "stripTotal", "growthMetric", "measureHint", "sweepLight",
    "sweepGap", "lightSlope", "gapSlope", "runSweep", "refState", "computeReference",
    "viewTabs", "canvasWrap", "viewNote", "refBadge", "hudAccum", "hudLight",
    "historyCard", "guardState", "historyTitle", "historyDetail", "historyOrbit",
    "cameraCut", "guardToggle", "cutAngle", "cutCount", "cutLatency", "toastStack",
    "helpButton", "helpDialog", "closeHelp", "stageLoading", "webgpuError",
    "splitLabels", "probeOverlay"
  ];
  ids.forEach((id) => { els[id] = document.getElementById(id); });
}

function bindControls() {
  const sliders = {
    lightWidth: (value) => Number(value),
    lightDepth: (value) => Number(value),
    boardGap: (value) => Number(value),
    boardOffset: (value) => Number(value),
    boardWidth: (value) => Number(value),
    historyAlpha: (value) => Number(value)
  };
  Object.entries(sliders).forEach(([id, parse]) => {
    els[id].addEventListener("input", (event) => {
      applyState({ [id]: parse(event.target.value) });
    });
  });

  $$("#sampleRate button").forEach((button) => {
    button.addEventListener("click", () => {
      applyState({ sampleRate: Number(button.dataset.value) });
      showToast(`每帧面积采样已设为 ${button.dataset.value} SPP`);
    });
  });

  $$("#viewTabs button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $$(".preset-grid button").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  els.resetHistory.addEventListener("click", resetHistory);
  els.computeReference.addEventListener("click", () => requestReference(true));
  els.runSweep.addEventListener("click", () => runSweep(false));
  els.cameraCut.addEventListener("click", cameraCut);
  els.guardToggle.addEventListener("change", () => {
    staleHistory = false;
    updateHistoryPanel("normal");
    showToast(els.guardToggle.checked ? "摄像机突变保护已启用" : "摄像机突变保护已关闭，可能保留陈旧历史", els.guardToggle.checked ? "info" : "warn");
  });

  $("#helpButton").addEventListener("click", () => els.helpDialog.showModal());
  els.closeHelp.addEventListener("click", () => els.helpDialog.close());
  els.helpDialog.addEventListener("click", (event) => {
    if (event.target === els.helpDialog) els.helpDialog.close();
  });

  const canvas = $("#gpuCanvas");
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    cameraState.yaw -= dx * 0.0062;
    cameraState.pitch = clamp(cameraState.pitch + dy * 0.005, 0.06, 1.18);
    refreshCamera(true, true, true);
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    cameraState.distance = clamp(cameraState.distance + event.deltaY * 0.0038, 5.1, 11.2);
    refreshCamera(true, true, true);
  }, { passive: false });

  window.addEventListener("resize", () => {
    refreshCamera(false, false);
    scheduleMeasurement();
    if (viewNeedsReference()) requestReference(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, button, dialog")) return;
    const views = ["beauty", "split", "visibility", "samples", "error"];
    const index = Number(event.key) - 1;
    if (index >= 0 && index < views.length) setView(views[index]);
    if (event.key.toLowerCase() === "r") requestReference(true);
  });
}

function applyState(patch) {
  Object.assign(state, patch);
  lastSceneChange = performance.now();
  syncControls();
  framesSinceReset = 0;
  renderer?.requestHistoryReset();
  renderer?.invalidateReference();
  updateReferenceState("STALE");
  pendingReference = false;
  scheduleMeasurement();
  clearTimeout(sweepTimer);
  if (sweepResults) {
    sweepTimer = setTimeout(() => runSweep(true), 420);
  }
}

function syncControls() {
  els.lightWidth.value = state.lightWidth;
  els.lightDepth.value = state.lightDepth;
  els.boardGap.value = state.boardGap;
  els.boardOffset.value = state.boardOffset;
  els.boardWidth.value = state.boardWidth;
  els.historyAlpha.value = state.historyAlpha;
  els.lightWidthOut.textContent = `${state.lightWidth.toFixed(2)} m`;
  els.lightDepthOut.textContent = `${state.lightDepth.toFixed(2)} m`;
  els.boardGapOut.textContent = `${state.boardGap.toFixed(2)} m`;
  els.boardOffsetOut.textContent = `${state.boardOffset.toFixed(2)} m`;
  els.boardWidthOut.textContent = `${state.boardWidth.toFixed(2)} m`;
  els.historyAlphaOut.textContent = state.historyAlpha.toFixed(2);
  els.hudLight.textContent = `${state.lightWidth.toFixed(2)} × ${state.lightDepth.toFixed(2)} m`;
  els.lightPreview.firstElementChild.style.width = `${24 + (state.lightWidth / 4.2) * 62}%`;
  $$(".range").forEach(updateRangeFill);
  $$("#sampleRate button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.value) === state.sampleRate);
  });
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function applyPreset(name) {
  const presets = {
    contact: { lightWidth: 0.9, lightDepth: 1.0, boardGap: 0.02, boardOffset: 0, boardWidth: 2.3, sampleRate: 4 },
    soft: { lightWidth: 4.0, lightDepth: 2.55, boardGap: 0.78, boardOffset: 0.18, boardWidth: 2.8, sampleRate: 4 },
    offset: { lightWidth: 2.4, lightDepth: 1.45, boardGap: 0.24, boardOffset: 0.55, boardWidth: 2.5, sampleRate: 4 }
  };
  applyState(presets[name]);
  $$(".preset-grid button").forEach((button) => button.classList.toggle("active", button.dataset.preset === name));
  showToast(`已载入预设：${name === "contact" ? "接触硬边" : name === "soft" ? "大面积柔光" : "远距遮挡"}`);
}

function refreshCamera(resetHistory, markChange = true, detectCut = false) {
  const previousCamera = camera;
  const rect = $("#gpuCanvas").getBoundingClientRect();
  cameraState.aspect = Math.max(0.35, rect.width / Math.max(1, rect.height));
  camera = createCamera(cameraState);
  if (markChange) lastSceneChange = performance.now();
  const angleDelta = angleBetween(previousCamera.forward, camera.forward) * 180 / Math.PI;
  const translationDelta = Math.hypot(
    previousCamera.position[0] - camera.position[0],
    previousCamera.position[1] - camera.position[1],
    previousCamera.position[2] - camera.position[2]
  );
  if (detectCut && (angleDelta > 9 || translationDelta > 1.3)) {
    lastCutAngle = angleDelta;
    cutCount += 1;
    els.cutAngle.textContent = `${angleDelta.toFixed(1)}°`;
    els.cutCount.textContent = String(cutCount);
    renderer?.invalidateReference();
    updateReferenceState("STALE");
    if (els.guardToggle.checked) {
      framesSinceReset = 0;
      renderer?.requestHistoryReset();
      staleHistory = false;
      updateHistoryPanel("purged", { delta: angleDelta, translation: translationDelta });
    } else {
      staleHistory = true;
      updateHistoryPanel("stale", { delta: angleDelta, translation: translationDelta });
    }
    return;
  }
  if (resetHistory) {
    framesSinceReset = 0;
    renderer?.requestHistoryReset();
    renderer?.invalidateReference();
    updateReferenceState("STALE");
  }
}

function setView(view) {
  const modes = { beauty: 0, split: 1, visibility: 2, samples: 3, error: 4 };
  viewMode = modes[view] ?? 0;
  $$("#viewTabs button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.canvasWrap.classList.toggle("split-mode", viewMode === 1);
  const notes = {
    beauty: "",
    split: "左 / 实时随机累积   ·   右 / 离线 256 SPP 固定参考",
    visibility: "可见性等值线  ·  青色描边 = 5% 与 95% 半影边界",
    samples: "历史样本年龄  ·  深蓝 = 新样本  ·  亮青 = 已收敛",
    error: "| 实时累积 − 离线参考 |  ·  黄 / 红 = 可见性误差"
  };
  setViewNote(notes[view] || "");
  if (viewNeedsReference()) {
    if (renderer?.referenceValid) updateReferenceState("READY");
    else {
      requestReference(view === "error" || view === "split");
      updateReferenceState(pendingReference ? "QUEUED" : "STALE");
    }
  }
}

function viewNeedsReference() {
  return viewMode === 1 || viewMode === 4;
}

function setViewNote(text) {
  els.viewNote.textContent = text;
  els.viewNote.classList.toggle("visible", Boolean(text));
}

function requestReference(immediate) {
  pendingReference = true;
  forceReferenceOnce = true;
  referenceRequestedAt = performance.now();
  if (immediate) lastSceneChange = Math.min(lastSceneChange, performance.now() - 1000);
  renderer?.invalidateReference();
  updateReferenceState("QUEUED");
  if (!renderer) {
    pendingReference = false;
    updateReferenceState("STALE");
  }
}

function updateReferenceState(label) {
  if (!els.refState) return;
  els.refState.textContent = label;
  els.refState.classList.toggle("ready", label === "READY");
  els.refState.classList.toggle("busy", label === "RENDERING" || label === "QUEUED");
  const kicker = els.refBadge.querySelector(".hud-kicker");
  if (label === "READY") {
    kicker.textContent = "REFERENCE";
    els.hudAccum.textContent = "256 SPP · READY";
  } else if (label === "RENDERING" || label === "QUEUED") {
    kicker.textContent = "REFERENCE";
    els.hudAccum.textContent = "RENDERING 256 SPP";
  } else {
    kicker.textContent = "TEMPORAL";
    els.hudAccum.textContent = "ACCUMULATING";
  }
}

function resetHistory() {
  framesSinceReset = 0;
  renderer?.requestHistoryReset();
  staleHistory = false;
  renderer?.invalidateReference();
  lastSceneChange = performance.now();
  updateHistoryPanel("reset");
  showToast("历史缓冲已清空，随机可见性从当前帧重新累积");
}

function cameraCut() {
  const previous = camera;
  cameraState.yaw += 1.18 + Math.random() * 0.42;
  cameraState.pitch = 0.1 + Math.random() * 0.22;
  cameraState.distance = 7.2 + Math.random() * 1.2;
  refreshCamera(false, false);
  const delta = angleBetween(previous.forward, camera.forward) * 180 / Math.PI;
  const translation = Math.hypot(
    previous.position[0] - camera.position[0],
    previous.position[1] - camera.position[1],
    previous.position[2] - camera.position[2]
  );
  lastCutAngle = delta;
  cutCount += 1;
  els.cutAngle.textContent = `${delta.toFixed(1)}°`;
  els.cutCount.textContent = String(cutCount);
  lastSceneChange = performance.now();
  renderer?.invalidateReference();
  updateReferenceState("STALE");
  pendingLatency = true;
  cutStartedAt = performance.now();

  if (els.guardToggle.checked) {
    framesSinceReset = 0;
    renderer?.requestHistoryReset();
    staleHistory = false;
    updateHistoryPanel("purged", { delta, translation });
    showToast(`检测到镜头突变 ${delta.toFixed(1)}° · 历史已清除`);
  } else {
    staleHistory = true;
    updateHistoryPanel("stale", { delta, translation });
    showToast(`镜头突变 ${delta.toFixed(1)}° · 历史保护关闭，陈旧历史被保留`, "warn");
  }
  if (viewNeedsReference()) requestReference(false);
}

function updateHistoryPanel(mode, data = {}) {
  const guardOn = els.guardToggle.checked;
  els.guardState.classList.remove("warn", "off");
  els.historyOrbit.classList.remove("warn");
  if (!guardOn) els.guardState.classList.add("off");
  if (mode === "stale") {
    els.guardState.textContent = "STALE";
    els.guardState.classList.add("warn");
    els.historyOrbit.classList.add("warn");
    els.historyTitle.textContent = "检测到误保留历史";
    els.historyDetail.textContent = `镜头突变 ${(data.delta || lastCutAngle).toFixed(1)}°，但旧可见性未清除；当前画面存在重影风险。`;
  } else if (mode === "purged") {
    els.guardState.textContent = "PURGED";
    els.historyTitle.textContent = "突变已拦截，历史已清除";
    els.historyDetail.textContent = `${(data.delta || lastCutAngle).toFixed(1)}° 角度跳变，${(data.translation || 0).toFixed(2)} m 位移；随机积分已从当前帧重启。`;
  } else if (mode === "reset") {
    els.guardState.textContent = guardOn ? "ARMED" : "DISARMED";
    els.historyTitle.textContent = "历史缓冲已手动清空";
    els.historyDetail.textContent = "当前帧将作为新的随机采样起点。";
  } else {
    els.guardState.textContent = guardOn ? "ARMED" : "DISARMED";
    els.historyTitle.textContent = guardOn ? "历史校验正常" : "突变保护已关闭";
    els.historyDetail.textContent = guardOn
      ? "上一帧与当前视图连续，累积缓冲有效。"
      : "控制器不会自动清除突变历史，可用于复现陈旧样本。";
  }
}

function angleBetween(a, b) {
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
}

function renderFrame(now) {
  if (!renderer || !renderer.ready) return;
  const rect = $("#gpuCanvas").getBoundingClientRect();
  const aspect = Math.max(0.35, rect.width / Math.max(1, rect.height));
  if (Math.abs(aspect - cameraState.aspect) > 0.001) {
    cameraState.aspect = aspect;
    camera = createCamera(cameraState);
  }

  const automaticReference = viewNeedsReference() &&
    !renderer.referenceValid &&
    now - lastSceneChange > 240;
  const referenceDue = (pendingReference && (
    forceReferenceOnce || now - lastSceneChange > 190
  )) || automaticReference;
  let computedReference = false;
  try {
    renderer.render({
      state,
      camera,
      mode: viewMode,
      computeReference: referenceDue
    });
  } catch (error) {
    console.error(error);
    showToast(`渲染错误：${error.message}`, "warn");
    return;
  }

  if (referenceDue) {
    computedReference = true;
    pendingReference = false;
    forceReferenceOnce = false;
    referenceReadyAt = performance.now();
    updateReferenceState("READY");
  }

  framesSinceReset += 1;
  if (pendingLatency) {
    els.cutLatency.textContent = `${(performance.now() - cutStartedAt).toFixed(1)} ms`;
    pendingLatency = false;
  }
  if (now - lastStatsAt > 180) {
    lastStatsAt = now;
    updateStats(now, computedReference);
  }
  updateProbeOverlay();
  frameHandle = requestAnimationFrame(renderFrame);
}

function updateStats(now, computedReference) {
  const frameDelta = Math.max(0.1, now - previousFrameTime);
  previousFrameTime = now;
  $("#frameTime").textContent = `${frameDelta.toFixed(1)} ms`;
  const historyGain = 1 - Math.pow(1 - state.historyAlpha, framesSinceReset);
  const effective = Math.min(256, Math.max(1, Math.round(state.sampleRate * historyGain / Math.max(state.historyAlpha, 0.01))));
  $("#sampleCount").textContent = String(effective);
  if (computedReference) {
    els.hudAccum.innerHTML = "REFERENCE LOCKED";
  } else if (staleHistory) {
    els.hudAccum.innerHTML = "STALE HISTORY";
  } else {
    els.hudAccum.innerHTML = `${effective} SPP · TRACKING`;
  }
}

function updateProbeOverlay() {
  if (!els.probeOverlay || !measurement.length) return;
  while (els.probeOverlay.children.length < PROBE_Z.length) {
    const tag = document.createElement("div");
    tag.className = "probe-tag";
    tag.innerHTML = "<b>P1</b><span>—</span>";
    els.probeOverlay.append(tag);
  }
  const width = els.canvasWrap.clientWidth;
  const height = els.canvasWrap.clientHeight;
  const tan = camera.tanHalfFov;
  measurement.forEach((probe, index) => {
    const tag = els.probeOverlay.children[index];
    const world = [
      Number.isFinite(probe.halfEdge) ? probe.halfEdge : -state.boardWidth * 0.5 - 0.15,
      0.012,
      probe.z
    ];
    const relative = [
      world[0] - camera.position[0],
      world[1] - camera.position[1],
      world[2] - camera.position[2]
    ];
    const depth = relative[0] * camera.forward[0] + relative[1] * camera.forward[1] + relative[2] * camera.forward[2];
    if (depth < 0.15) {
      tag.style.display = "none";
      return;
    }
    const cameraX = relative[0] * camera.right[0] + relative[1] * camera.right[1] + relative[2] * camera.right[2];
    const cameraY = relative[0] * camera.up[0] + relative[1] * camera.up[1] + relative[2] * camera.up[2];
    const ndcX = cameraX / (depth * tan * camera.aspect);
    const ndcY = cameraY / (depth * tan);
    const left = (ndcX * 0.5 + 0.5) * width;
    const top = (1 - (ndcY * 0.5 + 0.5)) * height;
    if (left < 24 || left > width - 24 || top < 22 || top > height - 36) {
      tag.style.display = "none";
      return;
    }
    tag.style.display = "flex";
    tag.style.left = `${left}px`;
    const leader = 12 + index * 24;
    tag.style.top = `${top - index * 24}px`;
    tag.style.setProperty("--leader", `${leader}px`);
    tag.style.setProperty("--tag-color", PROBE_COLORS[index]);
    tag.querySelector("b").textContent = `P${index + 1}`;
    tag.querySelector("span").textContent = Number.isFinite(probe.width)
      ? `${probe.width.toFixed(2)} m`
      : "no edge";
  });
}

function scheduleMeasurement(immediate = false) {
  clearTimeout(measureTimer);
  measureTimer = setTimeout(runMeasurement, immediate ? 0 : 45);
}

function runMeasurement() {
  measurement = measurePenumbra(state, { areaSamples: 56, slices: 64 });
  updateProbeCards();
  drawProfileChart();
}

function updateProbeCards() {
  if (!els.probeGrid.children.length) {
    els.probeGrid.innerHTML = PROBE_Z.map((_, index) => `
      <div class="probe" data-probe="${index}">
        <div class="probe-top"><span class="probe-id">P${index + 1}</span><span class="probe-depth">z +${PROBE_Z[index].toFixed(2)}</span></div>
        <div class="probe-value">—</div>
        <div class="probe-bar"><i></i></div>
      </div>
    `).join("");
  }

  const valid = measurement.map((point) => point.width).filter(Number.isFinite);
  const maximum = Math.max(0.25, ...valid);
  measurement.forEach((point, index) => {
    const probe = els.probeGrid.querySelector(`[data-probe="${index}"]`);
    const width = Number.isFinite(point.width) ? point.width : null;
    probe.style.setProperty("--probe-color", PROBE_COLORS[index]);
    probe.querySelector(".probe-value").innerHTML = width === null
      ? "— <small>no edge</small>"
      : `${width.toFixed(2)} <small>m</small>`;
    probe.querySelector(".probe-bar i").style.setProperty("--probe-fill", `${width === null ? 0 : (width / maximum) * 100}%`);
  });

  const first = measurement.find((point) => Number.isFinite(point.width));
  const last = [...measurement].reverse().find((point) => Number.isFinite(point.width));
  if (first && last && last !== first) {
    const growth = last.width - first.width;
    const slope = growth / Math.max(0.0001, last.z - first.z);
    els.stripTotal.textContent = `+${growth.toFixed(2)} m`;
    els.growthMetric.textContent = slope.toFixed(2);
  } else {
    els.stripTotal.textContent = "—";
    els.growthMetric.textContent = "—";
  }
  const validCount = measurement.filter((point) => Number.isFinite(point.width)).length;
  els.measureHint.textContent = `${validCount}/5 探针有效 · 56×64 samples`;
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

function drawProfileChart() {
  const fitted = fitCanvas(els.profileChart);
  if (!fitted) return;
  const { context: ctx, width, height } = fitted;
  const margin = { left: 29, right: 12, top: 13, bottom: 20 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = measurement.map((point) => point.width).filter(Number.isFinite);
  const maxValue = Math.max(0.35, ...values) * 1.14;
  const xAt = (index) => margin.left + (index / (measurement.length - 1)) * plotWidth;
  const yAt = (value) => margin.top + plotHeight - (value / maxValue) * plotHeight;

  ctx.save();
  ctx.font = '7px "SFMono-Regular", Consolas, monospace';
  ctx.fillStyle = "rgba(137, 153, 170, 0.7)";
  ctx.strokeStyle = "rgba(157, 181, 204, 0.09)";
  ctx.lineWidth = 1;
  for (let tick = 0; tick <= 3; tick += 1) {
    const value = (maxValue * tick) / 3;
    const y = yAt(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(`${value.toFixed(1)}m`, 2, y + 2.5);
  }

  const validPoints = measurement
    .map((point, index) => ({ x: xAt(index), y: Number.isFinite(point.width) ? yAt(point.width) : null, point }))
    .filter((point) => point.y !== null);

  if (validPoints.length) {
    const gradient = ctx.createLinearGradient(0, margin.top, 0, height - margin.bottom);
    gradient.addColorStop(0, "rgba(105, 215, 232, 0.20)");
    gradient.addColorStop(1, "rgba(105, 215, 232, 0)");
    ctx.beginPath();
    ctx.moveTo(validPoints[0].x, margin.top + plotHeight);
    validPoints.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(validPoints[validPoints.length - 1].x, margin.top + plotHeight);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    validPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "#69d7e8";
    ctx.lineWidth = 1.6;
    ctx.shadowColor = "rgba(105, 215, 232, 0.4)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    validPoints.forEach((point) => {
      const index = measurement.indexOf(point.point);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.1, 0, Math.PI * 2);
      ctx.fillStyle = PROBE_COLORS[index];
      ctx.fill();
      ctx.strokeStyle = "rgba(7, 11, 16, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
  }

  ctx.textAlign = "center";
  measurement.forEach((point, index) => {
    ctx.fillStyle = PROBE_COLORS[index];
    ctx.fillText(`P${index + 1}`, xAt(index), height - 6);
  });
  ctx.textAlign = "left";
  ctx.restore();
}

async function runSweep(automatic) {
  if (sweepBusy) return;
  sweepBusy = true;
  els.runSweep.classList.add("busy");
  els.runSweep.textContent = "扫描中…";
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const lightPoints = [];
  const lightValues = [0.4, 1.0, 1.6, 2.2, 2.8, 3.4, 4.1];
  for (const lightWidth of lightValues) {
    const probeState = { ...state, lightWidth };
    const points = measurePenumbra(probeState, { areaSamples: 32, slices: 46 });
    const widths = points.map((point) => point.width).filter(Number.isFinite).sort((a, b) => a - b);
    const value = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
    lightPoints.push({ x: lightWidth, y: value });
  }

  const gapPoints = [];
  const gapValues = [0.02, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
  for (const boardGap of gapValues) {
    const probeState = { ...state, boardGap };
    const edge = measureContactEdge(probeState, { areaSamples: 48, slices: 64 });
    gapPoints.push({ x: boardGap, y: edge.width || 0 });
  }

  const lightSlope = linearSlope(lightPoints);
  const gapSlope = linearSlope(gapPoints);
  drawMiniPlot(els.sweepLight, lightPoints, "#69d7e8");
  drawMiniPlot(els.sweepGap, gapPoints, "#ffb45d");
  els.lightSlope.textContent = formatSlope(lightSlope);
  els.gapSlope.textContent = formatSlope(gapSlope);
  sweepResults = { lightPoints, gapPoints, lightSlope, gapSlope };
  sweepBusy = false;
  els.runSweep.classList.remove("busy");
  els.runSweep.textContent = "运行 14 组";
  if (!automatic) showToast("参数扫描完成：光源宽度与遮挡距离各 7 组");
}

function linearSlope(points) {
  const count = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / count;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / count;
  let numerator = 0;
  let denominator = 0;
  points.forEach((point) => {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

function formatSlope(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} m/m`;
}

function drawMiniPlot(canvas, points, color) {
  const fitted = fitCanvas(canvas);
  if (!fitted) return;
  const { context: ctx, width, height } = fitted;
  const padding = { left: 5, right: 5, top: 7, bottom: 8 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(0.05, ...points.map((point) => point.y)) * 1.12;
  const xAt = (x) => padding.left + ((x - minX) / (maxX - minX || 1)) * (width - padding.left - padding.right);
  const yAt = (y) => height - padding.bottom - (y / maxY) * (height - padding.top - padding.bottom);

  ctx.strokeStyle = "rgba(157, 181, 204, 0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    const y = padding.top + (index / 2) * (height - padding.top - padding.bottom);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${color}45`);
  gradient.addColorStop(1, `${color}00`);
  ctx.beginPath();
  ctx.moveTo(xAt(points[0].x), height - padding.bottom);
  points.forEach((point) => ctx.lineTo(xAt(point.x), yAt(point.y)));
  ctx.lineTo(xAt(points[points.length - 1].x), height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xAt(point.x);
    const y = yAt(point.y);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(xAt(point.x), yAt(point.y), 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

function showToast(message, kind = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${kind === "warn" ? "warn" : ""}`;
  const dot = document.createElement("i");
  const copy = document.createElement("span");
  copy.textContent = message;
  toast.append(dot, copy);
  els.toastStack.append(toast);
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 220);
  }, 3100);
}

init();
