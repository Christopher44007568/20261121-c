import { ScreenRenderer } from "./renderer.js";
import {
  PIPELINES,
  captureArtifacts,
  runExperiment,
} from "./experiment.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("view");
const runButton = $("run");
const downloadButton = $("download");

const state = {
  mode: "alpha",
  alphaMode: 2,
  samples: 4,
  distance: 4.0,
  tiltDegrees: 30,
  threshold: 0.5,
  showContours: false,
  debugHoles: false,
  split: 0.5,
};

let renderer;
let report = null;
let busy = false;
let resizeQueued = false;
let ready = false;

function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status-dot").className = kind;
}

function currentSettings() {
  const width = canvas.width;
  const height = canvas.height;
  return {
    width,
    height,
    mode: state.mode,
    alphaMode: state.alphaMode,
    samples: state.samples,
    distance: state.distance,
    tiltDegrees: state.tiltDegrees,
    threshold: state.threshold,
    showContours: state.showContours,
    debugHoles: state.debugHoles,
    split: state.split,
    jitter: [0, 0],
    showBackground: true,
  };
}

function resizeToStage() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let width = Math.max(320, Math.round(rect.width * dpr));
  let height = Math.max(240, Math.round(rect.height * dpr));
  const maxPixels = 2_800_000;
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  renderer.resizeCanvas(width, height);
  $("viewport-size").textContent = `${width} × ${height} px`;
}

function pipelineId() {
  if (state.mode === "geometry") return "geometry";
  if (state.alphaMode === 1) return "dither";
  if (state.alphaMode === 2) return "a2c4";
  return "hard";
}

function pipelineMeasured() {
  if (state.mode === "geometry") return state.samples === 4;
  if (state.alphaMode === 2) return state.samples === 4;
  return state.samples === 0;
}

function modeLabel() {
  if (state.mode === "geometry") return "TRUE MESH GEOMETRY";
  if (state.mode === "split") {
    return `SPLIT · ${state.alphaMode === 0 ? "BINARY" : state.alphaMode === 1 ? "BAYER" : "A2C"} / TRUE MESH`;
  }
  if (state.alphaMode === 0) return `BINARY ALPHA TEST · ${state.samples <= 1 ? "1×" : `${state.samples}× MSAA`}`;
  if (state.alphaMode === 1) return `BAYER ALPHA TEST · ${state.samples <= 1 ? "1×" : `${state.samples}× MSAA`}`;
  return `ALPHA-TO-COVERAGE · ${state.samples <= 1 ? "1×" : `${state.samples}× MSAA`}`;
}

function updateHud() {
  $("hud-mode").textContent = modeLabel();
  $("hud-camera").textContent = `d ${state.distance.toFixed(1)} · tilt ${state.tiltDegrees}° · α ${state.threshold.toFixed(2)}`;
  $("camera-output").textContent = `d ${state.distance.toFixed(1)} / ${state.tiltDegrees}°`;
  $("distance-value").textContent = state.distance.toFixed(1);
  $("tilt-value").textContent = `${state.tiltDegrees}°`;
  $("threshold-value").textContent = state.threshold.toFixed(2);
  $("sample-tag").textContent = state.samples <= 1 ? "1×" : `${state.samples}×`;
  $("split-value").textContent = `${Math.round(state.split * 100)}%`;
  $("split-labels").hidden = state.mode !== "split";
  $("split-control").hidden = state.mode !== "split";
  $("contour-note").hidden = !state.showContours;
  $("frame-note").textContent = state.mode === "split"
    ? "拖动分割线对照两种轮廓"
    : state.mode === "geometry"
      ? "真实厚度 / 孔壁 / 边缘"
      : "GPU 覆盖率管线";
}

function renderCurrent() {
  if (!renderer || !ready) return;
  if (canvas.width < 2 || canvas.height < 2) resizeToStage();
  renderer.renderAndPresent(currentSettings());
  updateHud();
  downloadButton.disabled = false;
  updateMetricCards();
}

function scheduleRender() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeToStage();
    renderCurrent();
  });
}

function choosePipelineRow() {
  if (!report) return null;
  const id = pipelineId();
  const candidates = report.measurements.filter((row) => row.pipeline === id);
  if (!candidates.length) return null;
  const nearest = candidates.reduce((best, row) => {
    const score = Math.abs(row.distance - state.distance) * 10 + Math.abs(row.tiltDegrees - state.tiltDegrees);
    if (!best || score < best.score) return { row, score };
    return best;
  }, null);
  return nearest?.row ?? null;
}

function setMetric(id, value, grade = "") {
  const node = $(id);
  node.textContent = value;
  node.className = grade;
}

function grade(value, good, warn, suffix = "") {
  if (!Number.isFinite(value)) return ["—", ""];
  const cls = Math.abs(value) <= good ? "good" : Math.abs(value) <= warn ? "warn" : "bad";
  return [`${value.toFixed(2)}${suffix}`, cls];
}

function updateMetricCards() {
  const row = choosePipelineRow();
  const source = $("metric-source");
  if (!row || !pipelineMeasured()) {
    source.textContent = report ? "该采样未扫描" : "未扫描";
    setMetric("m-hole", "—");
    setMetric("m-error", "—");
    setMetric("m-flicker", "—");
    setMetric("m-toggle", "—");
    setMetric("m-mae", "—");
    return;
  }
  source.textContent = `d ${row.distance.toFixed(1)} · ${row.tiltDegrees}° · ${PIPELINES.find((p) => p.id === row.pipeline)?.short ?? row.pipeline}`;
  setMetric("m-hole", `${row.holeFractionPct.toFixed(2)}%`);
  const [errorText, errorClass] = grade(row.holeErrorPp, 0.5, 3, " pp");
  setMetric("m-error", errorText, errorClass);
  const [flickerText, flickerClass] = grade(row.flickerStdPct, 0.35, 1.4, " pp");
  setMetric("m-flicker", flickerText, flickerClass);
  const [toggleText, toggleClass] = grade(row.togglePct, 2, 12, "%");
  setMetric("m-toggle", toggleText, toggleClass);
  const [maeText, maeClass] = grade(row.edgeMaePct, 0.6, 2.5, " pp");
  setMetric("m-mae", maeText, maeClass);
}

function buildMipBars() {
  const levels = renderer.mask.levels;
  const opens = levels.map((level) => (1 - level.metalFraction) * 100);
  const min = Math.min(...opens);
  const max = Math.max(...opens);
  const span = Math.max(0.25, max - min);
  const container = $("mip-bars");
  container.innerHTML = "";
  opens.forEach((open, index) => {
    const level = document.createElement("div");
    level.className = "mip-level";
    level.title = `L${index} · ${levels[index].width}×${levels[index].height} · ${open.toFixed(2)}% open`;
    const height = 19 + ((open - min) / span) * 37;
    const bar = document.createElement("i");
    bar.style.height = `${height}px`;
    const label = document.createElement("span");
    label.textContent = `L${index}`;
    level.append(bar, label);
    container.append(level);
  });
  $("mip-analytic").textContent = `${((1 - renderer.mask.analyticMetalFraction) * 100).toFixed(2)}% open`;
}

function renderCostChart() {
  const container = $("cost-chart");
  container.innerHTML = "";
  const costs = report.msaaCost.filter((entry) => Number.isFinite(entry.msMedian));
  const max = Math.max(...costs.map((entry) => entry.msMedian), 0.001);
  const software = report.environment.accelerationClass === "software-rasterizer"
    || costs.some((entry) => entry.timerSource === "cpu_finish_fallback");
  for (const entry of costs) {
    const row = document.createElement("div");
    row.className = `cost-row${software ? " software" : ""}`;
    const label = document.createElement("span");
    label.textContent = entry.samples <= 1 ? "1×" : `${entry.samples}×`;
    const track = document.createElement("div");
    track.className = "cost-track";
    const bar = document.createElement("i");
    bar.style.width = `${Math.max(2, (entry.msMedian / max) * 100)}%`;
    track.append(bar);
    const value = document.createElement("b");
    value.textContent = `${entry.msMedian.toFixed(2)} ms · ${entry.relativeTo1x.toFixed(2)}×`;
    value.title = `${entry.width}×${entry.height}, ${entry.timerSource}`;
    row.append(label, track, value);
    container.append(row);
  }
  $("timer-source").textContent = software
    ? "CPU FALLBACK"
    : report.msaaCost[0]?.timerSource === "gpu_timer" ? "GPU TIMER" : "MEASURED";
  $("cost-note").textContent = software
    ? "当前环境为软件光栅；图中是满屏填充 + MSAA resolve 压力测试，仅验证相对开销，不代表硬件性能。"
    : "满屏填充 + MSAA resolve 压力测试；场景帧时间另存于 report.json。相对 1× 归一化。";
}

function renderSummary() {
  const container = $("summary-table");
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "summary-row head";
  header.innerHTML = "<span>PIPELINE</span><span>|HOLE ERR|</span><span>FLICKER</span><span>TOGGLE</span>";
  container.append(header);
  for (const row of report.summary) {
    const node = document.createElement("div");
    node.className = "summary-row";
    const label = PIPELINES.find((pipeline) => pipeline.id === row.pipeline)?.short ?? row.pipeline;
    node.innerHTML = `<span class="pipe"><i></i><b>${label}</b></span>` +
      `<span>${row.meanAbsHoleErrorPp.toFixed(2)}pp</span>` +
      `<span>${row.meanFlickerStdPct.toFixed(2)}pp</span>` +
      `<span>${row.meanTogglePct.toFixed(1)}%</span>`;
    container.append(node);
  }
}

function applyReport(nextReport) {
  report = nextReport;
  window.SCREEN_LAB_REPORT = report;
  updateMetricCards();
  renderCostChart();
  renderSummary();
  downloadButton.disabled = false;
  setStatus(
    `完成 · ${report.measurements.length} 行 · ${(report.durationMs / 1000).toFixed(1)}s`,
    "ready",
  );
}

function setScanProgress(progress) {
  $("scan-progress").hidden = false;
  const completed = progress.completed ?? 0;
  const total = progress.total ?? 20;
  const percent = Math.min(100, Math.round((completed / total) * 100));
  $("scan-message").textContent = progress.message ?? "扫描中…";
  $("scan-percent").textContent = `${percent}%`;
  $("progress-bar").style.width = `${percent}%`;
}

async function executeExperiment(progressCallback) {
  return runExperiment(renderer, (progress) => {
    setScanProgress(progress);
    progressCallback?.(progress);
  });
}

async function runFullScan() {
  if (!ready || busy) return report;
  busy = true;
  runButton.disabled = true;
  setStatus("扫描中：距离 × 倾角 × 管线…", "working");
  $("scan-progress").hidden = false;
  $("scan-percent").textContent = "0%";
  $("progress-bar").style.width = "0%";
  try {
    const result = await executeExperiment();
    applyReport(result);
    $("scan-message").textContent = "扫描完成";
    $("scan-percent").textContent = "100%";
    $("progress-bar").style.width = "100%";
    setTimeout(() => { $("scan-progress").hidden = true; }, 700);
    renderCurrent();
    return result;
  } catch (error) {
    console.error(error);
    setStatus(`扫描失败：${error.message}`, "error");
    throw error;
  } finally {
    busy = false;
    runButton.disabled = false;
  }
}

async function captureCurrentArtifacts(currentReport = report) {
  if (!currentReport) throw new Error("Run the measurement sweep before exporting artifacts.");
  const artifacts = await captureArtifacts(renderer, currentReport, (progress) => {
    if (progress.message) $("scan-message").textContent = progress.message;
  });
  resizeToStage();
  renderCurrent();
  return artifacts;
}

function downloadCurrentFrame() {
  renderCurrent();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `screen-frame-d${state.distance.toFixed(1)}-t${state.tiltDegrees}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

function bindSegments(containerId, dataKey, callback) {
  const container = $(containerId);
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const child of container.querySelectorAll("button")) child.classList.remove("active");
    button.classList.add("active");
    callback(Number(button.dataset[dataKey]));
  });
}

function bindUI() {
  $("distance").addEventListener("input", (event) => {
    state.distance = Number(event.target.value);
    updateHud();
    renderCurrent();
  });
  $("tilt").addEventListener("input", (event) => {
    state.tiltDegrees = Number(event.target.value);
    updateHud();
    renderCurrent();
  });
  $("threshold").addEventListener("input", (event) => {
    state.threshold = Number(event.target.value);
    updateHud();
    renderCurrent();
  });
  $("split").addEventListener("input", (event) => {
    state.split = Number(event.target.value) / 100;
    updateHud();
    renderCurrent();
  });
  $("contours").addEventListener("change", (event) => {
    state.showContours = event.target.checked;
    updateHud();
    renderCurrent();
  });
  $("debug-holes").addEventListener("change", (event) => {
    state.debugHoles = event.target.checked;
    renderCurrent();
  });
  bindSegments("mode-segments", "mode", (value) => {
    state.mode = value;
    updateHud();
    renderCurrent();
  });
  bindSegments("alpha-segments", "alpha", (value) => {
    state.alphaMode = value;
    if (value === 2 && state.samples < 2) {
      state.samples = 4;
      syncSegments("msaa-segments", "samples", 4);
    }
    if (value !== 2 && state.samples > 1) {
      state.samples = 0;
      syncSegments("msaa-segments", "samples", 0);
    }
    updateHud();
    renderCurrent();
  });
  bindSegments("msaa-segments", "samples", (value) => {
    state.samples = value;
    if (value === 0 && state.alphaMode === 2) {
      state.alphaMode = 0;
      syncSegments("alpha-segments", "alpha", 0);
    }
    updateHud();
    renderCurrent();
  });
  runButton.addEventListener("click", () => runFullScan());
  downloadButton.addEventListener("click", downloadCurrentFrame);
  new ResizeObserver(scheduleRender).observe(stage);
  window.addEventListener("resize", scheduleRender);
}

function syncSegments(containerId, dataKey, value) {
  const container = $(containerId);
  for (const button of container.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset[dataKey]) === value);
  }
}

async function init() {
  try {
    renderer = new ScreenRenderer(canvas);
    const name = renderer.info.unmaskedRenderer || renderer.info.renderer;
    $("renderer-name").textContent = name;
    $("gpu-detail").textContent = `${renderer.info.vendor} · max ${renderer.info.maxSamples}× MSAA · anisotropy ${renderer.info.anisotropy}×`;
    const eightTimes = document.querySelector('#msaa-segments [data-samples="8"]');
    if (renderer.info.maxSamples < 8 && eightTimes) {
      eightTimes.disabled = true;
      eightTimes.title = `本设备最大 ${renderer.info.maxSamples}× MSAA`;
      eightTimes.textContent = "N/A";
    }
    buildMipBars();
    bindUI();
    ready = true;
    resizeToStage();
    renderCurrent();
    setStatus("就绪 · 可运行完整扫描", "ready");
    window.ScreenLab = {
      renderer,
      state,
      runFullScan,
      runExperiment: executeExperiment,
      captureArtifacts: captureCurrentArtifacts,
      getReport: () => report,
    };
    window.SCREEN_LAB_READY = true;
  } catch (error) {
    console.error(error);
    setStatus(`WebGL2 初始化失败：${error.message}`, "error");
    $("renderer-name").textContent = "WEBGL2 UNAVAILABLE";
    window.SCREEN_LAB_ERROR = error.message;
  }
}

init();
