import { InkSimulation } from "./simulation.js";

const PALETTE = {
  ink: { label: "松烟", absorbance: [0.97, 0.97, 0.97] },
  indigo: { label: "花青", absorbance: [0.78, 0.57, 0.15] },
  cinnabar: { label: "朱砂", absorbance: [0.11, 0.62, 0.79] },
  ochre: { label: "赭石", absorbance: [0.22, 0.43, 0.76] }
};

const state = {
  sim: null,
  tool: "brush",
  color: "ink",
  pigment: 0.62,
  brushWater: 0.72,
  brushSize: 34,
  fiberAngle: 18,
  anisotropy: 0.72,
  showFibers: true,
  running: true,
  speed: 1,
  stepsPerFrame: 1,
  step: 0,
  frameAccumulator: 0,
  metricsAccumulator: 0,
  baselineTotal: null,
  baselineStep: 0,
  lastStats: { mobile: 0, deposit: 0, water: 0, total: 0 },
  lastBoundaryFlux: 0,
  lastMassError: 0,
  pointer: null,
  panPointer: null,
  busy: false,
  exporting: false,
  tests: [],
  fps: 60,
  fpsFrames: 0,
  fpsTime: performance.now()
};

const elements = {};
const byId = (id) => document.getElementById(id);

function cacheElements() {
  [
    "glCanvas", "paperFrame", "gpuLabel", "clockReadout", "statusMessage", "cursorReadout",
    "fpsReadout", "domainLabel", "domainNote", "stepLabel", "stateBadge", "canvasHint",
    "simToast", "zoomLabel", "zoomIn", "zoomOut", "zoomFit", "playButton", "playIcon",
    "playLabel", "speedLabel", "stepButton", "simSpeed", "simSpeedOut", "evaporation",
    "evaporationOut", "mobileMass", "depositMass", "totalMass", "waterMass",
    "conservationFill", "boundaryFlux", "massError", "testReport", "runAllTests",
    "exportButton", "exportProgressFill", "exportStatus", "resetButton", "toggleGuide",
    "pigmentAmount", "pigmentAmountOut", "brushWater", "brushWaterOut", "brushSize",
    "brushSizeOut", "fiberAngle", "fiberAngleOut", "fiberAnisotropy",
    "fiberAnisotropyOut", "fiberDial", "dialNeedle", "fiberLegend", "showFibers"
  ].forEach((id) => {
    elements[id] = byId(id);
  });
}

function formatMass(value) {
  const safe = Math.max(0, value || 0);
  if (safe >= 100000) return `${(safe / 1000).toFixed(1)}k`;
  if (safe >= 10000) return `${(safe / 1000).toFixed(2)}k`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(3)}k`;
  return safe.toFixed(3);
}

function formatError(value) {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude < 0.00005) return "0.000%";
  if (magnitude < 0.01) return `${value >= 0 ? "+" : ""}${value.toFixed(4)}%`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

let toastTimer = 0;
function showToast(message, duration = 1900) {
  elements.simToast.textContent = message;
  elements.simToast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.simToast.classList.remove("is-visible");
  }, duration);
}

function setBusy(busy, label = "") {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  if (label) setStatus(label);
}

function updateClock() {
  const now = new Date();
  elements.clockReadout.textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
}

function updatePlayUi() {
  elements.playIcon.className = state.running ? "pause-icon" : "play-icon";
  elements.playButton.setAttribute("aria-label", state.running ? "暂停" : "继续");
  elements.playLabel.textContent = state.running ? "仿真运行中" : "仿真已暂停";
  elements.stateBadge.textContent = state.running ? "运行中" : "已暂停";
  elements.stateBadge.classList.toggle("is-warm", state.running);
}

function refreshMetrics() {
  if (!state.sim || state.busy) return;
  const stats = state.sim.sampleStats();
  const boundary = state.sim.readBoundaryFlux();
  const hasBaseline = state.baselineTotal !== null;
  state.lastStats = stats;
  state.lastBoundaryFlux = boundary;
  state.lastMassError =
    hasBaseline && state.baselineTotal > 0
      ? ((stats.total - state.baselineTotal) / state.baselineTotal) * 100
      : 0;

  elements.mobileMass.textContent = formatMass(stats.mobile);
  elements.depositMass.textContent = formatMass(stats.deposit);
  elements.totalMass.textContent = formatMass(stats.total);
  elements.waterMass.textContent = formatMass(stats.water);
  elements.boundaryFlux.textContent = boundary.toExponential(2);
  elements.massError.textContent =
    hasBaseline ? formatError(state.lastMassError) : "基线待定";

  const health = hasBaseline && state.baselineTotal > 0
    ? Math.max(0, 1 - Math.min(Math.abs(state.lastMassError) * 30, 1))
    : 1;
  elements.conservationFill.style.transform = `scaleX(${health.toFixed(4)})`;
  elements.conservationFill.style.background =
    health > 0.96 ? "var(--good)" : health > 0.8 ? "var(--accent)" : "var(--bad)";
}

function setBaselineFromCurrent() {
  if (!state.sim) return;
  const stats = state.sim.sampleStats();
  state.lastStats = stats;
  state.baselineTotal = stats.total;
  state.baselineStep = state.step;
  refreshMetrics();
}

function updateStepUi() {
  elements.stepLabel.textContent = String(state.step).padStart(4, "0");
}

function setZoom(zoom, anchor = null) {
  if (!state.sim) return;
  const nextZoom = Math.max(0.6, Math.min(4.5, zoom));
  if (anchor) {
    const rect = elements.glCanvas.getBoundingClientRect();
    const screenX = (anchor.clientX - rect.left) / rect.width;
    const screenY = 1 - (anchor.clientY - rect.top) / rect.height;
    const current = state.sim;
    const simX = (screenX - 0.5) / current.zoom + 0.5 + current.panX;
    const simY = (screenY - 0.5) / current.zoom + 0.5 + current.panY;
    current.panX = simX - 0.5 - (screenX - 0.5) / nextZoom;
    current.panY = simY - 0.5 - (screenY - 0.5) / nextZoom;
  }
  state.sim.setPresentation({ zoom: nextZoom });
  state.sim.clampPan();
  state.sim.present();
  elements.zoomLabel.textContent = `${Math.round(nextZoom * 100)}%`;
}

function resetSimulation({ announce = true } = {}) {
  state.sim.reset();
  state.step = 0;
  state.frameAccumulator = 0;
  state.metricsAccumulator = 0;
  state.baselineTotal = 0;
  state.lastMassError = 0;
  state.lastStats = { mobile: 0, deposit: 0, water: 0, total: 0 };
  updateStepUi();
  refreshMetrics();
  if (announce) showToast("纸面已清空");
  setStatus("仿真域已重置 · 颜料质量归零");
}

function currentBrushSegment(start, end, mode = state.tool) {
  const color = PALETTE[state.color].absorbance;
  const radius = state.brushSize * 0.5;
  if (mode === "water") {
    return {
      start,
      end,
      radius: radius * 1.08,
      mode: "water",
      pigment: 0,
      water: 0.32 + state.brushWater * 0.52,
      color: [0, 0, 0]
    };
  }
  return {
    start,
    end,
    radius,
    mode: "brush",
    pigment: 0.16 + state.pigment * 0.5,
    water: 0.12 + state.brushWater * 0.82,
    color
  };
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  elements.glCanvas.style.cursor = tool === "pan" ? "grab" : "crosshair";
}

function updateFiberUi() {
  const angle = Number(elements.fiberAngle.value);
  const anisotropy = Number(elements.fiberAnisotropy.value) / 100;
  state.fiberAngle = angle;
  state.anisotropy = anisotropy;
  elements.fiberAngleOut.textContent = `${angle}°`;
  elements.fiberAnisotropyOut.textContent = anisotropy.toFixed(2);
  elements.fiberLegend.textContent = `纤维 ${angle}° · 各向异性 ${anisotropy.toFixed(2)}`;
  elements.dialNeedle.style.transform = `rotate(${-angle}deg)`;
  state.sim.setFiber(angle, anisotropy, { regenerate: true });
  state.sim.present();
}

function updateSliderReadouts() {
  state.pigment = Number(elements.pigmentAmount.value) / 100;
  state.brushWater = Number(elements.brushWater.value) / 100;
  state.brushSize = Number(elements.brushSize.value);
  elements.pigmentAmountOut.textContent = elements.pigmentAmount.value;
  elements.brushWaterOut.textContent = elements.brushWater.value;
  elements.brushSizeOut.textContent = `${elements.brushSize.value} px`;
}

function bindControls() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  document.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.color = button.dataset.color;
      document.querySelectorAll("[data-color]").forEach((swatch) => {
        swatch.classList.toggle("is-active", swatch === button);
      });
    });
  });

  elements.pigmentAmount.addEventListener("input", updateSliderReadouts);
  elements.brushWater.addEventListener("input", updateSliderReadouts);
  elements.brushSize.addEventListener("input", updateSliderReadouts);
  elements.fiberAngle.addEventListener("input", updateFiberUi);
  elements.fiberAnisotropy.addEventListener("input", updateFiberUi);
  elements.showFibers.addEventListener("change", () => {
    state.showFibers = elements.showFibers.checked;
    state.sim.setPresentation({ showFibers: state.showFibers });
    state.sim.present();
  });

  elements.playButton.addEventListener("click", () => {
    state.running = !state.running;
    updatePlayUi();
  });
  elements.stepButton.addEventListener("click", () => {
    state.running = false;
    updatePlayUi();
    state.sim.step(1);
    state.step += 1;
    state.sim.present();
    updateStepUi();
    refreshMetrics();
  });
  elements.simSpeed.addEventListener("input", () => {
    state.stepsPerFrame = Number(elements.simSpeed.value) / 100;
    state.speed = state.stepsPerFrame;
    elements.simSpeedOut.textContent = `${state.stepsPerFrame.toFixed(1)}×`;
    elements.speedLabel.textContent = `${state.stepsPerFrame.toFixed(2)} 步 / 帧`;
  });
  elements.evaporation.addEventListener("input", () => {
    const raw = Number(elements.evaporation.value);
    state.sim.evaporation = 0.001 + raw * 0.000525;
    elements.evaporationOut.textContent = state.sim.evaporation.toFixed(4);
  });

  elements.resetButton.addEventListener("click", () => resetSimulation());
  elements.toggleGuide.addEventListener("click", () => {
    elements.canvasHint.classList.toggle("is-hidden");
  });
  elements.zoomIn.addEventListener("click", () => setZoom(state.sim.zoom * 1.22));
  elements.zoomOut.addEventListener("click", () => setZoom(state.sim.zoom / 1.22));
  elements.zoomFit.addEventListener("click", () => {
    state.sim.setPresentation({ zoom: 1, panX: 0, panY: 0 });
    state.sim.present();
    elements.zoomLabel.textContent = "100%";
  });

  elements.glCanvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0014);
    setZoom(state.sim.zoom * factor, event);
  }, { passive: false });

  elements.glCanvas.addEventListener("pointerdown", onPointerDown);
  elements.glCanvas.addEventListener("pointermove", onPointerMove);
  elements.glCanvas.addEventListener("pointerup", onPointerUp);
  elements.glCanvas.addEventListener("pointercancel", onPointerUp);
  elements.glCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (key === "b") setTool("brush");
    if (key === "w") setTool("water");
    if (key === "h") setTool("pan");
    if (key === " ") {
      event.preventDefault();
      state.running = !state.running;
      updatePlayUi();
    }
  });
}

function onPointerDown(event) {
  if (state.busy) return;
  const panMode = event.button === 1 || event.altKey || state.tool === "pan";
  if (panMode) {
    event.preventDefault();
    state.panPointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    elements.glCanvas.setPointerCapture(event.pointerId);
    elements.glCanvas.style.cursor = "grabbing";
    return;
  }
  if (event.button !== 0) return;

  const point = state.sim.clientToSimulation(event.clientX, event.clientY);
  if (!point.inside) return;
  const position = [point.x, point.y];
  state.pointer = { id: event.pointerId, last: position };
  state.baselineTotal = null;
  elements.canvasHint.classList.add("is-hidden");
  state.sim.paint([currentBrushSegment(position, position)]);
  state.sim.present();
  elements.glCanvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (state.panPointer && state.panPointer.id === event.pointerId) {
    const rect = elements.glCanvas.getBoundingClientRect();
    const deltaX = (event.clientX - state.panPointer.x) / rect.width / state.sim.zoom;
    const deltaY = (event.clientY - state.panPointer.y) / rect.height / state.sim.zoom;
    state.sim.panX += deltaX;
    state.sim.panY -= deltaY;
    state.panPointer.x = event.clientX;
    state.panPointer.y = event.clientY;
    state.sim.clampPan();
    state.sim.present();
    return;
  }
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    const point = state.sim.clientToSimulation(event.clientX, event.clientY);
    elements.cursorReadout.textContent = point.inside
      ? `X ${Math.round(point.x)} / Y ${Math.round(point.y)}`
      : "X — / Y —";
    return;
  }

  const point = state.sim.clientToSimulation(event.clientX, event.clientY);
  const next = [point.x, point.y];
  const previous = state.pointer.last;
  const distance = Math.hypot(next[0] - previous[0], next[1] - previous[1]);
  if (distance > 0.35) {
    state.sim.paint([currentBrushSegment(previous, next)]);
    state.pointer.last = next;
    state.sim.present();
  }
  elements.cursorReadout.textContent = `X ${Math.round(point.x)} / Y ${Math.round(point.y)}`;
}

function onPointerUp(event) {
  if (state.panPointer && state.panPointer.id === event.pointerId) {
    state.panPointer = null;
    elements.glCanvas.style.cursor = state.tool === "pan" ? "grab" : "crosshair";
    if (elements.glCanvas.hasPointerCapture(event.pointerId)) {
      elements.glCanvas.releasePointerCapture(event.pointerId);
    }
    return;
  }
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.pointer = null;
  if (elements.glCanvas.hasPointerCapture(event.pointerId)) {
    elements.glCanvas.releasePointerCapture(event.pointerId);
  }
  window.setTimeout(setBaselineFromCurrent, 0);
}

function setScenarioSettings(angle, anisotropy) {
  elements.fiberAngle.value = angle;
  elements.fiberAnisotropy.value = Math.round(anisotropy * 100);
  state.fiberAngle = angle;
  state.anisotropy = anisotropy;
  elements.fiberAngleOut.textContent = `${angle}°`;
  elements.fiberAnisotropyOut.textContent = anisotropy.toFixed(2);
  elements.fiberLegend.textContent = `纤维 ${angle}° · 各向异性 ${anisotropy.toFixed(2)}`;
  elements.dialNeedle.style.transform = `rotate(${-angle}deg)`;
  state.sim.setFiber(angle, anisotropy, { regenerate: true });
}

function beginControlledRun() {
  state.running = false;
  updatePlayUi();
  state.sim.reset();
  state.step = 0;
  state.frameAccumulator = 0;
  state.metricsAccumulator = 0;
  state.baselineTotal = null;
}

function finishControlledRun(steps) {
  state.step = steps;
  state.sim.present();
  state.sim.sampleStats();
  updateStepUi();
}

function yieldTask() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function runCrossTest() {
  beginControlledRun();
  setScenarioSettings(0, 0.82);
  const y = 390;
  const x = 480;
  state.sim.paint([{
    start: [175, y],
    end: [785, y],
    radius: 13.5,
    mode: "brush",
    pigment: 0.37,
    water: 0.8,
    color: PALETTE.cinnabar.absorbance
  }]);
  state.sim.paint([{
    start: [x, 165],
    end: [x, 575],
    radius: 13.5,
    mode: "brush",
    pigment: 0.37,
    water: 0.8,
    color: PALETTE.indigo.absorbance
  }]);

  const initial = state.sim.sampleStats();
  const haloBefore = state.sim.sampleMobileRegion(496, 406, 22, 22);
  const steps = 60;
  state.sim.step(steps);
  const final = state.sim.sampleStats();
  const center = state.sim.sampleMobilePoint(x, y, 7);
  const redBranch = state.sim.sampleMobileRegion(635, 383, 18, 14);
  const blueBranch = state.sim.sampleMobileRegion(473, 510, 14, 18);
  const halo = state.sim.sampleMobileRegion(496, 406, 22, 22);
  const alongFiber = state.sim.sampleMobileRegion(496, 500, 38, 30);
  const acrossFiber = state.sim.sampleMobileRegion(620, 405, 34, 30);
  const massError = ((final.total - initial.total) / Math.max(initial.total, 1e-9)) * 100;
  const ratio = alongFiber.mass / Math.max(acrossFiber.mass, 1e-9);
  const overlapGain = center.mass / Math.max(redBranch.mass, blueBranch.mass, 1e-9);

  finishControlledRun(steps);
  state.baselineTotal = initial.total;
  state.baselineStep = 0;
  state.lastMassError = massError;
  const pass =
    overlapGain > 1.32 &&
    halo.mass > 0.00003 &&
    halo.mass > haloBefore.mass * 1.08 &&
    ratio > 1.08 &&
    Math.abs(massError) < 0.75;
  return {
    id: "cross",
    name: "交叉处扩散",
    pass,
    value: `${ratio.toFixed(2)}× 纵向导流`,
    detail: `重叠 ${overlapGain.toFixed(2)}× · 交叉晕染 ${haloBefore.mass.toFixed(4)}→${halo.mass.toFixed(4)} · 质量误差 ${formatError(massError)}`,
    metrics: {
      ratio,
      overlapGain,
      halo: halo.mass,
      haloBefore: haloBefore.mass,
      center: center.mass,
      redBranch: redBranch.mass,
      blueBranch: blueBranch.mass,
      alongFiber: alongFiber.mass,
      acrossFiber: acrossFiber.mass,
      massError,
      steps
    }
  };
}

async function runBoundaryTest() {
  beginControlledRun();
  setScenarioSettings(35, 0.9);
  state.sim.paint([{
    start: [21, 190],
    end: [21, 450],
    radius: 17,
    mode: "brush",
    pigment: 0.34,
    water: 0.92,
    color: PALETTE.ink.absorbance
  }]);
  state.sim.paint([{
    start: [939, 190],
    end: [939, 450],
    radius: 17,
    mode: "brush",
    pigment: 0.34,
    water: 0.92,
    color: PALETTE.cinnabar.absorbance
  }]);
  state.sim.paint([{
    start: [260, 19],
    end: [700, 19],
    radius: 16,
    mode: "brush",
    pigment: 0.26,
    water: 0.9,
    color: PALETTE.ochre.absorbance
  }]);

  const initial = state.sim.sampleStats();
  const steps = 34;
  state.sim.step(steps);
  const final = state.sim.sampleStats();
  const boundaryFlux = state.sim.readBoundaryFlux();
  const massError = ((final.total - initial.total) / Math.max(initial.total, 1e-9)) * 100;
  finishControlledRun(steps);
  state.baselineTotal = initial.total;
  state.baselineStep = 0;
  state.lastMassError = massError;
  const pass = boundaryFlux < 1e-7 && Math.abs(massError) < 0.75;
  return {
    id: "boundary",
    name: "无通量边界",
    pass,
    value: boundaryFlux < 1e-7 ? "通量 0" : boundaryFlux.toExponential(2),
    detail: `边界总通量 ${boundaryFlux.toExponential(2)} · 质量误差 ${formatError(massError)}`,
    metrics: { boundaryFlux, massError, steps }
  };
}

async function runConservationTest() {
  beginControlledRun();
  setScenarioSettings(42, 0.65);
  const horizontal = {
    start: [205, 335],
    end: [755, 352],
    radius: 15,
    mode: "brush",
    pigment: 0.4,
    water: 0.86,
    color: PALETTE.cinnabar.absorbance
  };
  const vertical = {
    start: [462, 170],
    end: [494, 552],
    radius: 15,
    mode: "brush",
    pigment: 0.4,
    water: 0.86,
    color: PALETTE.indigo.absorbance
  };
  state.sim.paint([horizontal]);
  state.sim.paint([vertical]);

  const initial = state.sim.sampleStats();
  state.sim.step(18);
  const beforeRewet = state.sim.sampleStats();
  const rewet = (stroke) => ({
    ...stroke,
    radius: stroke.radius * 1.28,
    mode: "water",
    pigment: 0,
    water: 0.95,
    color: [0, 0, 0]
  });
  state.sim.paint([rewet(horizontal), rewet(vertical)]);
  const immediatelyAfterRewet = state.sim.sampleStats();
  state.sim.step(5);
  const afterRewet = state.sim.sampleStats();
  state.sim.step(49);
  const final = state.sim.sampleStats();
  const steps = 72;
  const massError = ((final.total - initial.total) / Math.max(initial.total, 1e-9)) * 100;
  const depositFraction = final.deposit / Math.max(final.total, 1e-9);
  const rewetLift = beforeRewet.deposit - immediatelyAfterRewet.deposit;
  finishControlledRun(steps);
  state.baselineTotal = initial.total;
  state.baselineStep = 0;
  state.lastMassError = massError;
  const pass =
    Math.abs(massError) < 0.75 &&
    depositFraction > 0.01 &&
    rewetLift > 0;
  return {
    id: "conservation",
    name: "全局颜料守恒",
    pass,
    value: formatError(massError),
    detail: `沉积占 ${(depositFraction * 100).toFixed(1)}% · 重蘸水提升 ${formatMass(rewetLift)}`,
    metrics: {
      massError,
      depositFraction,
      rewetLift,
      depositBeforeRewet: beforeRewet.deposit,
      depositImmediatelyAfterRewet: immediatelyAfterRewet.deposit,
      depositAfterRewet: afterRewet.deposit,
      mobileBeforeRewet: beforeRewet.mobile,
      mobileAfterRewet: afterRewet.mobile,
      steps
    }
  };
}

function renderTestReport(results) {
  if (!results.length) {
    elements.testReport.innerHTML = '<div class="report-empty">受控笔划会重置纸面并读取 GPU 浮点缓冲。</div>';
    return;
  }
  elements.testReport.innerHTML = results.map((result) => `
    <div class="report-row ${result.pass ? "pass" : "fail"}">
      <span class="report-mark"></span>
      <span><strong>${result.name}</strong><small>${result.detail}</small></span>
      <em>${result.pass ? "PASS" : "FAIL"}</em>
    </div>
  `).join("");
}

async function runTest(name) {
  const testMap = {
    cross: runCrossTest,
    boundary: runBoundaryTest,
    conservation: runConservationTest
  };
  if (!testMap[name]) return null;
  setBusy(true, `正在运行受控诊断 · ${name}`);
  await yieldTask();
  const result = await testMap[name]();
  state.tests = state.tests.filter((item) => item.id !== result.id).concat(result);
  state.tests.sort((a, b) => ["cross", "boundary", "conservation"].indexOf(a.id) - ["cross", "boundary", "conservation"].indexOf(b.id));
  renderTestReport(state.tests);
  setBusy(false);
  refreshMetrics();
  setStatus(`${result.name}：${result.pass ? "通过" : "未通过"} · ${result.detail}`);
  return result;
}

async function runAllTests() {
  if (state.busy) return state.tests;
  setBusy(true, "正在运行三组受控诊断…");
  state.tests = [];
  renderTestReport([]);
  for (const test of [runCrossTest, runBoundaryTest, runConservationTest]) {
    await yieldTask();
    const result = await test();
    state.tests.push(result);
    renderTestReport(state.tests);
  }
  setBusy(false);
  refreshMetrics();
  const passed = state.tests.filter((result) => result.pass).length;
  setStatus(`诊断完成：${passed} / ${state.tests.length} 项通过`);
  showToast(`诊断完成 · ${passed}/${state.tests.length} 通过`, 2600);
  return state.tests;
}

function setExportProgress(ratio, message) {
  elements.exportProgressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  if (message) elements.exportStatus.textContent = message;
}

async function exportProcessFrames(directory) {
  if (state.exporting) return { canceled: true };
  if (!window.inkApi) throw new Error("桌面导出接口不可用");
  state.exporting = true;
  setBusy(true, "正在准备过程帧…");
  beginControlledRun();
  setScenarioSettings(18, 0.72);
  state.sim.setPresentation({ zoom: 1, panX: 0, panY: 0, showFibers: true });
  elements.zoomLabel.textContent = "100%";

  const x = 480;
  const y = 385;
  state.sim.paint([{
    start: [180, y],
    end: [780, y],
    radius: 16,
    mode: "brush",
    pigment: 0.36,
    water: 0.83,
    color: PALETTE.cinnabar.absorbance
  }]);
  state.sim.paint([{
    start: [x, 160],
    end: [x, 565],
    radius: 16,
    mode: "brush",
    pigment: 0.36,
    water: 0.83,
    color: PALETTE.indigo.absorbance
  }]);
  state.sim.paint([{
    start: [x + 88, 250],
    end: [x + 188, 340],
    radius: 9,
    mode: "brush",
    pigment: 0.24,
    water: 0.68,
    color: PALETTE.ochre.absorbance
  }]);

  const initial = state.sim.sampleStats();
  const frames = [];
  const frameCount = 19;
  const stride = 8;
  const manifest = {
    application: "FIBER / INK",
    scenario: "controlled-cross",
    simulation: {
      width: state.sim.width,
      height: state.sim.height,
      fiberAngleDegrees: 18,
      anisotropy: 0.72,
      evaporation: state.sim.evaporation,
      depositRate: state.sim.depositRate,
      liftRate: state.sim.liftRate,
      fixedDomain: true
    },
    frameCount,
    stepStride: stride,
    initialMass: initial,
    frames,
    tests: state.tests
  };

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (frameIndex > 0) state.sim.step(stride);
      const step = frameIndex * stride;
      state.sim.present();
      const stats = state.sim.sampleStats();
      const dataUrl = state.sim.captureFrame();
      const filename = `frame_${String(frameIndex).padStart(3, "0")}_step_${String(step).padStart(3, "0")}.png`;
      await window.inkApi.writeFrame({ directory, name: filename, dataUrl });
      frames.push({
        file: filename,
        step,
        mobileMass: stats.mobile,
        depositedMass: stats.deposit,
        totalMass: stats.total,
        waterMass: stats.water,
        pigmentDriftPercent: ((stats.total - initial.total) / initial.total) * 100
      });
      state.step = step;
      updateStepUi();
      const progress = (frameIndex + 1) / frameCount;
      setExportProgress(progress, `写入 ${frameIndex + 1} / ${frameCount} · STEP ${String(step).padStart(3, "0")}`);
      setStatus(`过程帧导出 ${Math.round(progress * 100)}% · ${filename}`);
      await yieldTask();
    }

    manifest.finalMass = state.sim.sampleStats();
    manifest.pigmentDriftPercent =
      ((manifest.finalMass.total - initial.total) / initial.total) * 100;
    state.baselineTotal = initial.total;
    state.baselineStep = 0;
    state.lastMassError = manifest.pigmentDriftPercent;
    await window.inkApi.writeManifest({
      directory,
      name: "process-manifest.json",
      manifest
    });
    setExportProgress(1, `完成 · ${frameCount} 帧 + manifest`);
    setStatus(`过程帧已导出至 ${directory}`);
    showToast(`已导出 ${frameCount} 帧过程图`, 2800);
    state.exporting = false;
    setBusy(false);
    refreshMetrics();
    return { canceled: false, directory, manifest };
  } catch (error) {
    state.exporting = false;
    setBusy(false);
    setExportProgress(0, `导出失败：${error.message}`);
    setStatus(`导出失败：${error.message}`);
    throw error;
  }
}

function exposeDebugApi() {
  window.__fiberInk = {
    ready: true,
    runAllTests,
    runCrossTest: () => runTest("cross"),
    runBoundaryTest: () => runTest("boundary"),
    runConservationTest: () => runTest("conservation"),
    exportFramesTo: (directory) => exportProcessFrames(directory),
    captureFrame: () => state.sim.captureFrame(),
    getDiagnostics: () => ({
      step: state.step,
      running: state.running,
      simulation: {
        width: state.sim.width,
        height: state.sim.height,
        fixedDomain: true,
        zoom: state.sim.zoom,
        fiberAngleDegrees: (state.sim.fiberAngle * 180) / Math.PI,
        anisotropy: state.sim.fiberAnisotropy
      },
      stats: state.lastStats,
      boundaryFlux: state.lastBoundaryFlux,
      massErrorPercent: state.lastMassError,
      tests: state.tests
    })
  };
}

function startRenderLoop() {
  let previous = performance.now();
  const render = (now) => {
    const delta = Math.min(100, now - previous);
    previous = now;
    state.fpsFrames += 1;
    if (now - state.fpsTime > 500) {
      state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsTime));
      elements.fpsReadout.textContent = `${state.fps} FPS`;
      state.fpsFrames = 0;
      state.fpsTime = now;
    }

    if (state.running && !state.busy && !state.pointer) {
      state.frameAccumulator += state.stepsPerFrame * (delta / 16.6667);
      const steps = Math.min(4, Math.floor(state.frameAccumulator));
      if (steps > 0) {
        state.frameAccumulator -= steps;
        state.sim.step(steps);
        state.step += steps;
        updateStepUi();
      }
    }
    state.sim.present();

    state.metricsAccumulator += delta;
    if (state.metricsAccumulator > 900 && !state.busy && !state.pointer) {
      state.metricsAccumulator = 0;
      refreshMetrics();
    }
    window.requestAnimationFrame(render);
  };
  window.requestAnimationFrame(render);
}

function initialize() {
  cacheElements();
  updateClock();
  window.setInterval(updateClock, 1000);
  try {
    state.sim = new InkSimulation(elements.glCanvas).init();
    const gl = state.sim.gl;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)).split(",")[0]
      : "WebGL2";
    elements.gpuLabel.textContent = `WEBGL2 · ${renderer.slice(0, 32)}`;
  } catch (error) {
    elements.gpuLabel.textContent = "WEBGL2 · 不可用";
    elements.statusMessage.textContent = error.message;
    elements.canvasHint.innerHTML = `<p>${error.message}。请启用桌面 GPU 加速后重新启动。</p>`;
    setBusy(true);
    return;
  }

  elements.domainLabel.textContent = `${state.sim.width} × ${state.sim.height}`;
  elements.domainNote.textContent = `${state.sim.width} × ${state.sim.height}`;
  elements.stepLabel.textContent = "0000";
  state.sim.evaporation = 0.001 + Number(elements.evaporation.value) * 0.000525;
  elements.evaporationOut.textContent = state.sim.evaporation.toFixed(4);
  updateSliderReadouts();
  updatePlayUi();
  updateFiberUi();
  state.sim.setPresentation({ showFibers: true });
  bindControls();
  setTool("brush");

  elements.runAllTests.addEventListener("click", runAllTests);
  document.querySelectorAll("[data-test]").forEach((button) => {
    button.addEventListener("click", () => runTest(button.dataset.test));
  });
  elements.exportButton.addEventListener("click", async () => {
    try {
      const directory = await window.inkApi.chooseExportDirectory();
      if (directory) await exportProcessFrames(directory);
    } catch (error) {
      setExportProgress(0, `导出失败：${error.message}`);
    }
  });

  new ResizeObserver(() => {
    state.sim.resizeCanvas();
    state.sim.present();
  }).observe(elements.paperFrame);

  exposeDebugApi();
  startRenderLoop();
  setBaselineFromCurrent();
  setStatus("GPU 管线就绪 · 缩放仅作用于视图 · 仿真域锁定");
  elements.canvasHint.classList.remove("is-hidden");
}

initialize();
