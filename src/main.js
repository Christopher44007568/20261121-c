import { bakeLightmap, bakeVertexAO, DEFAULT_BAKE } from "./ao.js";
import { BVH } from "./bvh.js";
import { ConvergenceChart } from "./chart.js";
import { ViewportRenderer } from "./renderer.js";
import { createScene, getSceneMeta, SCENE_IDS } from "./scenes.js";

const SAMPLE_COUNTS = [4, 8, 16, 32, 64, 128, 256, 512];
const START = performance.now();

const state = {
  activeId: "sphere-plane",
  scenes: new Map(),
  configs: new Map(),
  results: new Map(),
  convergence: null,
  diagnostics: null,
  chartType: "spp",
  markers: [],
  showAllMarkers: false,
  activeMarker: -1,
  requestId: 0,
  baking: false,
  autoTimer: 0,
  worker: null
};

const dom = {
  caseList: document.querySelector("#case-list"),
  samples: document.querySelector("#samples"),
  samplesValue: document.querySelector("#samples-value"),
  distance: document.querySelector("#max-distance"),
  distanceValue: document.querySelector("#distance-value"),
  directionality: document.querySelector("#directionality"),
  directionalityValue: document.querySelector("#directionality-value"),
  suppression: document.querySelector("#suppression"),
  autoRebake: document.querySelector("#auto-rebake"),
  bakeButton: document.querySelector("#bake-button"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  statusPill: document.querySelector("#status-pill"),
  sessionClock: document.querySelector("#session-clock"),
  caseCode: document.querySelector("#case-code"),
  caseTitle: document.querySelector("#case-title"),
  caseSubtitle: document.querySelector("#case-subtitle"),
  modeSwitch: document.querySelector("#mode-switch"),
  viewportBadge: document.querySelector("#viewport-badge"),
  viewportCorner: document.querySelector("#viewport-corner"),
  legendDistance: document.querySelector("#legend-distance"),
  gridToggle: document.querySelector("#grid-toggle"),
  exportButton: document.querySelector("#export-button"),
  markers: document.querySelector("#diagnostic-markers"),
  analysisCase: document.querySelector("#analysis-case"),
  statAo: document.querySelector("#stat-ao"),
  statTime: document.querySelector("#stat-time"),
  statVertices: document.querySelector("#stat-vertices"),
  statRmse: document.querySelector("#stat-rmse"),
  chartCaption: document.querySelector("#chart-caption"),
  chartHover: document.querySelector("#chart-hover"),
  diagBadge: document.querySelector("#diag-badge"),
  diagIntro: document.querySelector("#diag-intro"),
  diagList: document.querySelector("#diag-list"),
  diagAll: document.querySelector("#diag-all"),
  diagTotal: document.querySelector("#diag-total"),
  referenceImage: document.querySelector("#reference-image"),
  referenceLabel: document.querySelector("#reference-label"),
  toast: document.querySelector("#toast"),
  canvas: document.querySelector("#viewport"),
  chart: document.querySelector("#chart")
};

const renderer = new ViewportRenderer(dom.canvas);
const chart = new ConvergenceChart(dom.chart);
renderer.onRender = updateMarkerPositions;
chart.onHover = (entry) => {
  if (!entry) {
    dom.chartHover.textContent = "512 SPP REF";
    return;
  }
  if (state.chartType === "spp") {
    dom.chartHover.textContent = `${entry.samples} SPP · RMSE ${entry.rmse.toFixed(4)}`;
  } else {
    dom.chartHover.textContent = `${entry.maxDistance.toFixed(2)} M · AO ${entry.averageAO.toFixed(3)}`;
  }
};

function configFor(id) {
  if (!state.configs.has(id)) {
    const meta = getSceneMeta(id);
    state.configs.set(id, {
      ...DEFAULT_BAKE,
      maxDistance: meta.maxDistance,
      samples: 64,
      seed: 1,
      mode: "vertex",
      lightmapSize: 128
    });
  }
  return state.configs.get(id);
}

function sceneFor(id) {
  if (!state.scenes.has(id)) state.scenes.set(id, createScene(id));
  return state.scenes.get(id);
}

function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatAO(value) {
  return Number(value).toFixed(3);
}

function updateRangeTrack(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${percent}%`);
}

function syncControls() {
  const config = configFor(state.activeId);
  const sampleIndex = Math.max(0, SAMPLE_COUNTS.indexOf(config.samples));
  dom.samples.value = String(sampleIndex);
  dom.distance.value = String(config.maxDistance);
  dom.directionality.value = String(Math.round(config.directionality * 100));
  dom.suppression.checked = config.suppression;
  dom.samplesValue.innerHTML = `${config.samples} <small>SPP</small>`;
  dom.distanceValue.innerHTML = `${config.maxDistance.toFixed(2)} <small>M</small>`;
  dom.directionalityValue.innerHTML = `${Math.round(config.directionality * 100)}<small>%</small>`;
  dom.legendDistance.textContent = `RANGE ${config.maxDistance.toFixed(2)} M`;
  updateRangeTrack(dom.samples);
  updateRangeTrack(dom.distance);
  updateRangeTrack(dom.directionality);
  for (const button of dom.modeSwitch.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.mode === config.mode);
  }
}

function setStatus(text, busy = false) {
  dom.statusPill.textContent = text;
  dom.statusPill.classList.toggle("busy", busy);
}

function setProgress(value, label = null) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  dom.progressBar.style.width = `${percent}%`;
  dom.progressValue.textContent = `${percent}%`;
  if (label) dom.progressLabel.textContent = label;
}

let toastTimer = 0;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

function resultSignature(sceneId, config) {
  return [
    sceneId,
    config.mode,
    config.samples,
    config.maxDistance.toFixed(4),
    config.directionality.toFixed(3),
    config.suppression ? 1 : 0,
    config.seed,
    config.lightmapSize || 0
  ].join(":");
}

function initWorker() {
  try {
    state.worker = new Worker("/src/bake.worker.js", { type: "module" });
    state.worker.onmessage = (event) => handleWorkerMessage(event.data);
    state.worker.onerror = (event) => {
      console.error(event);
      setStatus("FALLBACK", false);
      toast("Worker 异常，切换主线程烘焙");
      state.worker = null;
      requestBake(true);
    };
  } catch (error) {
    console.warn("Worker unavailable", error);
    state.worker = null;
  }
}

function handleWorkerMessage(message) {
  if (message.requestId !== state.requestId) return;
  if (message.type === "progress") {
    setProgress(message.value);
    return;
  }
  if (message.type === "error") {
    state.baking = false;
    setStatus("ERROR", false);
    dom.bakeButton.disabled = false;
    setProgress(0, "CPU · ERROR");
    toast(`烘焙失败: ${message.message}`);
    return;
  }
  if (message.type === "result") finishBake(message.sceneId, message.result);
}

function finishBake(sceneId, result) {
  const config = configFor(sceneId);
  state.baking = false;
  dom.bakeButton.disabled = false;
  setStatus("IDLE", false);
  setProgress(1, `CPU · ${result.mode === "lightmap" ? "LIGHTMAP" : "VERTEX"}`);
  result.signature = resultSignature(sceneId, config);
  state.results.set(sceneId, result);
  if (sceneId === state.activeId) {
    renderer.setBakeResult(result);
    updateStats(result);
    updateViewportLabels(result);
    renderDiagnostics();
  }
  const card = dom.caseList.querySelector(`[data-scene="${sceneId}"]`);
  if (card) card.classList.add("baked");
}

async function localBake(sceneId, config, requestId) {
  await new Promise((resolve) => setTimeout(resolve, 30));
  const scene = sceneFor(sceneId);
  const bvh = new BVH(scene.mesh);
  const options = {
    ...config,
    bvh,
    lightmapSize: config.lightmapSize || 128
  };
  let lastUpdate = 0;
  const progress = (value) => {
    const now = performance.now();
    if (now - lastUpdate < 50) return;
    lastUpdate = now;
    if (requestId === state.requestId) setProgress(value);
  };
  try {
    const result = config.mode === "lightmap"
      ? bakeLightmap(scene, options, progress)
      : bakeVertexAO(scene, options, progress);
    if (requestId === state.requestId) finishBake(sceneId, result);
  } catch (error) {
    if (requestId === state.requestId) {
      state.baking = false;
      dom.bakeButton.disabled = false;
      setStatus("ERROR", false);
      setProgress(0, "CPU · ERROR");
      toast(`烘焙失败: ${error.message}`);
    }
  }
}

function requestBake(force = false) {
  const sceneId = state.activeId;
  const config = { ...configFor(sceneId) };
  const signature = resultSignature(sceneId, config);
  const cached = state.results.get(sceneId);
  if (!force && cached?.signature === signature) {
    renderer.setBakeResult(cached);
    updateStats(cached);
    updateViewportLabels(cached);
    renderDiagnostics();
    return;
  }
  state.requestId++;
  const requestId = state.requestId;
  state.baking = true;
  dom.bakeButton.disabled = true;
  setStatus("BAKING", true);
  setProgress(0, `CPU · ${config.mode === "lightmap" ? "LIGHTMAP" : "VERTEX"}`);
  updateViewportLabels(null);
  if (state.worker) {
    state.worker.postMessage({
      type: "bake",
      requestId,
      sceneId,
      config
    });
  } else {
    localBake(sceneId, config, requestId);
  }
}

function scheduleBake() {
  clearTimeout(state.autoTimer);
  if (!dom.autoRebake.checked) return;
  state.autoTimer = setTimeout(() => requestBake(true), 170);
}

function buildCaseList() {
  dom.caseList.innerHTML = "";
  SCENE_IDS.forEach((id, index) => {
    const meta = getSceneMeta(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "case-card";
    button.dataset.scene = id;
    button.innerHTML = `
      <span class="case-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="case-copy"><b>${meta.title}</b><small>${meta.subtitle}</small></span>
      <span class="case-status"></span>
    `;
    button.addEventListener("click", () => setActiveScene(id));
    dom.caseList.append(button);
  });
}

function updateCaseCardState() {
  const active = state.activeId;
  let index = 0;
  for (const button of dom.caseList.querySelectorAll(".case-card")) {
    const id = button.dataset.scene;
    button.classList.toggle("active", id === active);
    if (id === active) index = Number(button.querySelector(".case-index").textContent) - 1;
  }
  dom.analysisCase.textContent = `CASE ${String(index + 1).padStart(2, "0")}`;
}

function setActiveScene(id) {
  if (!SCENE_IDS.includes(id)) return;
  clearTimeout(state.autoTimer);
  state.activeId = id;
  state.activeMarker = -1;
  state.showAllMarkers = false;
  const scene = sceneFor(id);
  renderer.setScene(scene);
  syncControls();
  updateCaseCardState();
  dom.caseCode.textContent = scene.code;
  dom.caseTitle.textContent = scene.title;
  dom.caseSubtitle.textContent = scene.subtitle;
  dom.referenceImage.src = `/artifacts/reference/${id}-reference.png`;
  dom.referenceLabel.textContent = "512 SPP";
  dom.diagAll.textContent = "";
  dom.diagAll.append("显示全部异常点 ");
  const total = document.createElement("span");
  total.id = "diag-total";
  total.textContent = "0";
  dom.diagAll.append(total);
  dom.diagTotal = total;
  const cached = state.results.get(id);
  if (cached?.signature === resultSignature(id, configFor(id))) {
    renderer.setBakeResult(cached);
    updateStats(cached);
    updateViewportLabels(cached);
  } else {
    requestBake(true);
  }
  updateAnalysis();
}

function updateViewportLabels(result) {
  const config = configFor(state.activeId);
  const mode = config.mode === "lightmap" ? "光照贴图" : "顶点 AO";
  const samples = result?.samples ?? config.samples;
  dom.viewportBadge.textContent = `${mode} · ${samples} SPP${state.baking ? " · BAKING" : ""}`;
  dom.viewportCorner.textContent = config.mode === "lightmap" ? "LIGHTMAP · CPU" : "VERTEX · CPU";
}

function updateStats(result) {
  if (!result) return;
  dom.statAo.textContent = formatAO(result.averageAO);
  dom.statTime.textContent = formatMs(result.ms);
  dom.statVertices.textContent = Number(result.vertexCount).toLocaleString("en-US");
  const caseData = analysisCaseData();
  const config = configFor(state.activeId);
  const entry = caseData?.series?.length
    ? caseData.series.reduce((best, current) =>
      Math.abs(current.samples - config.samples) < Math.abs(best.samples - config.samples) ? current : best
    , caseData.series[0])
    : null;
  dom.statRmse.textContent = entry ? entry.rmse.toFixed(4) : "—";
}

function analysisCaseData() {
  if (!state.convergence?.cases) return null;
  return state.convergence.cases.find((entry) => entry.id === state.activeId) || null;
}

function diagnosticsCaseData() {
  const cases = state.diagnostics?.cases;
  if (!cases) return null;
  const entry = Array.isArray(cases)
    ? cases.find((entry) => entry.id === state.activeId)
    : cases[state.activeId];
  if (!entry) return null;
  return entry.stress ? { ...entry.stress, title: entry.title, stress: entry.stress } : entry;
}

function updateAnalysis() {
  const caseData = analysisCaseData();
  const diag = diagnosticsCaseData();
  const config = configFor(state.activeId);
  if (caseData) {
    chart.setData(caseData, state.chartType);
    chart.setSelected(state.chartType === "spp" ? config.samples : config.maxDistance);
  } else {
    chart.setData(null, state.chartType);
  }
  dom.chartCaption.textContent = state.chartType === "spp"
    ? "RMSE · 低差异采样"
    : "平均 AO · 最大距离扫描";
  dom.chartHover.textContent = "512 SPP REF";
  chart.setType(state.chartType);
  if (caseData) chart.setSelected(state.chartType === "spp" ? config.samples : config.maxDistance);
  for (const button of document.querySelectorAll("[data-chart]")) {
    button.classList.toggle("active", button.dataset.chart === state.chartType);
  }
  dom.diagIntro.textContent = diag
    ? `4 SPP 压力测试定位到 ${diag.total} 个相对参考显著变暗的顶点；点击条目在视口标记。`
    : "等待诊断数据。";
  dom.diagBadge.textContent = diag ? `${diag.samples} SPP · 无抑制` : "4 SPP · 无抑制";
  renderDiagnostics();
}

function renderDiagnostics() {
  const diag = diagnosticsCaseData();
  const points = diag?.points || [];
  state.markers = points;
  if (state.activeMarker >= points.length) state.activeMarker = -1;
  dom.diagList.innerHTML = "";
  if (!points.length) {
    const empty = document.createElement("div");
    empty.className = "diag-empty";
    empty.textContent = "当前压力设置未发现显著异常黑点";
    dom.diagList.append(empty);
  }
  const shown = points.slice(0, 4);
  shown.forEach((point, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `diag-item${state.activeMarker === index ? " active" : ""}`;
    const coords = point.position.map((value) => value.toFixed(2)).join("  ");
    button.innerHTML = `
      <span class="diag-cross"></span>
      <span class="diag-copy">
        <b>STRESS · ${point.part} · V${String(point.vertex).padStart(4, "0")}</b>
        <small>${coords} · REF ${point.referenceAO.toFixed(2)}</small>
      </span>
      <span class="diag-score">${point.ao.toFixed(2)}</span>
    `;
    button.addEventListener("click", () => {
      state.activeMarker = index;
      state.showAllMarkers = false;
      renderDiagnostics();
      updateMarkerPositions();
      const marker = dom.markers.children[index];
      if (marker) {
        marker.classList.remove("pulse");
        void marker.offsetWidth;
        marker.classList.add("pulse");
      }
    });
    dom.diagList.append(button);
  });
  dom.diagTotal.textContent = String(diag?.total ?? 0);
  dom.diagAll.firstChild.textContent = state.showAllMarkers ? "仅显示前四个 " : "显示全部异常点 ";
  rebuildMarkers();
}

function markerVisible(index) {
  return state.showAllMarkers || index < 4 || index === state.activeMarker;
}

function rebuildMarkers() {
  dom.markers.innerHTML = "";
  state.markers.forEach((_, index) => {
    if (!markerVisible(index)) return;
    const ring = document.createElement("span");
    ring.className = `marker-ring${index === state.activeMarker ? " pulse" : ""}`;
    ring.dataset.marker = String(index);
    dom.markers.append(ring);
  });
  updateMarkerPositions();
}

function updateMarkerPositions() {
  if (!state.markers.length) {
    dom.markers.innerHTML = "";
    return;
  }
  const rings = Array.from(dom.markers.children);
  let ringIndex = 0;
  state.markers.forEach((point, index) => {
    if (!markerVisible(index)) return;
    const ring = rings[ringIndex++];
    if (!ring) return;
    const projected = renderer.project(point.position);
    const inside = projected.visible &&
      projected.x > 8 && projected.y > 8 &&
      projected.x < dom.canvas.clientWidth - 8 &&
      projected.y < dom.canvas.clientHeight - 8;
    ring.style.display = inside ? "block" : "none";
    ring.style.left = `${projected.x}px`;
    ring.style.top = `${projected.y}px`;
  });
}

function updateSampleControl() {
  const config = configFor(state.activeId);
  const index = Number(dom.samples.value);
  config.samples = SAMPLE_COUNTS[index];
  config.seed = 1;
  dom.samplesValue.innerHTML = `${config.samples} <small>SPP</small>`;
  updateRangeTrack(dom.samples);
  updateViewportLabels(null);
  chart.setSelected(config.samples);
  scheduleBake();
}

function updateDistanceControl() {
  const config = configFor(state.activeId);
  config.maxDistance = Number(dom.distance.value);
  config.seed = 1;
  dom.distanceValue.innerHTML = `${config.maxDistance.toFixed(2)} <small>M</small>`;
  dom.legendDistance.textContent = `RANGE ${config.maxDistance.toFixed(2)} M`;
  updateRangeTrack(dom.distance);
  chart.setSelected(config.maxDistance);
  scheduleBake();
}

function updateDirectionalityControl() {
  const config = configFor(state.activeId);
  config.directionality = Number(dom.directionality.value) / 100;
  config.seed = 1;
  dom.directionalityValue.innerHTML = `${dom.directionality.value}<small>%</small>`;
  updateRangeTrack(dom.directionality);
  scheduleBake();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCurrent() {
  const result = state.results.get(state.activeId);
  if (!result) {
    toast("当前场景尚未完成烘焙");
    return;
  }
  const scene = sceneFor(state.activeId);
  if (result.mode === "vertex") {
    const lines = ["vertex,part,x,y,z,ao"];
    for (let i = 0; i < result.ao.length; i++) {
      const part = scene.parts[Math.round(scene.mesh.partIds[i])];
      lines.push([
        i,
        part?.id || "part",
        scene.mesh.positions[i * 3].toFixed(6),
        scene.mesh.positions[i * 3 + 1].toFixed(6),
        scene.mesh.positions[i * 3 + 2].toFixed(6),
        result.ao[i].toFixed(6)
      ].join(","));
    }
    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
      `ao-${state.activeId}-${result.samples}spp.csv`
    );
    toast(`已导出 ${result.samples} SPP 顶点 AO`);
  } else {
    const size = result.size;
    const columns = Math.min(4, result.layers.length);
    const rows = Math.ceil(result.layers.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = size * columns;
    canvas.height = size * rows;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    result.layers.forEach((layer, index) => {
      for (let i = 0; i < layer.data.length; i++) {
        const value = Math.round(Math.max(0, Math.min(1, layer.data[i])) * 255);
        image.data[i * 4] = value;
        image.data[i * 4 + 1] = value;
        image.data[i * 4 + 2] = value;
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, (index % columns) * size, Math.floor(index / columns) * size);
    });
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `ao-lightmap-${state.activeId}-${result.samples}spp.png`);
      toast(`已导出 ${result.layers.length} 层光照贴图`);
    }, "image/png");
  }
}

function bindEvents() {
  dom.samples.addEventListener("input", updateSampleControl);
  dom.distance.addEventListener("input", updateDistanceControl);
  dom.directionality.addEventListener("input", updateDirectionalityControl);
  dom.suppression.addEventListener("change", () => {
    configFor(state.activeId).suppression = dom.suppression.checked;
    configFor(state.activeId).seed = 1;
    scheduleBake();
  });
  dom.bakeButton.addEventListener("click", () => requestBake(true));
  dom.modeSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    const config = configFor(state.activeId);
    if (config.mode === button.dataset.mode) return;
    config.mode = button.dataset.mode;
    syncControls();
    updateAnalysis();
    requestBake(true);
  });
  dom.gridToggle.addEventListener("click", () => {
    const enabled = !renderer.showGrid;
    renderer.setGrid(enabled);
    dom.gridToggle.classList.toggle("active", enabled);
  });
  dom.exportButton.addEventListener("click", exportCurrent);
  document.querySelectorAll("[data-chart]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartType = button.dataset.chart;
      updateAnalysis();
    });
  });
  dom.diagAll.addEventListener("click", () => {
    state.showAllMarkers = !state.showAllMarkers;
    renderDiagnostics();
  });
  window.addEventListener("resize", () => {
    renderer.requestRender();
    chart.draw();
    updateMarkerPositions();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "b") return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    requestBake(true);
  });
  dom.referenceImage.addEventListener("error", () => {
    dom.referenceImage.removeAttribute("src");
    dom.referenceImage.alt = "参考图尚未生成，请运行 npm run generate";
  });
}

async function loadAnalysisData() {
  const [convergence, diagnostics] = await Promise.all([
    fetch("/artifacts/data/convergence.json").then((response) => {
      if (!response.ok) throw new Error("convergence missing");
      return response.json();
    }),
    fetch("/artifacts/data/diagnostics.json").then((response) => {
      if (!response.ok) throw new Error("diagnostics missing");
      return response.json();
    })
  ]).catch((error) => {
    console.warn("Analysis data unavailable", error);
    return [null, null];
  });
  state.convergence = convergence;
  state.diagnostics = diagnostics;
}

function startClock() {
  const update = () => {
    const seconds = Math.floor((performance.now() - START) / 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    dom.sessionClock.textContent = `${hh}:${mm}:${ss}`;
  };
  update();
  setInterval(update, 1000);
}

async function boot() {
  buildCaseList();
  bindEvents();
  initWorker();
  startClock();
  await loadAnalysisData();
  setActiveScene("sphere-plane");
  setStatus("IDLE", false);
}

boot().catch((error) => {
  console.error(error);
  setStatus("ERROR", false);
  toast(`初始化失败: ${error.message}`);
});
