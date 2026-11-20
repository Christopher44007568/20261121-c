import "./styles.css";
import { Viewer } from "./viewer/Viewer.js";
import { IdSelectionEngine } from "./selection/IdSelectionEngine.js";
import {
  compareHitManifests,
  normalizeRect,
  scaleCssRect,
} from "./selection/idCodec.js";

const $ = (selector) => document.querySelector(selector);

const stage = $("#stage");
const selectionBox = $("#selectionBox");
const boxLabel = $("#boxLabel");
const dragPrompt = $("#dragPrompt");
const stageToast = $("#stageToast");
const dprChip = $("#dprChip");
const bufferChip = $("#bufferChip");
const cameraReadout = $("#cameraReadout");
const pickableCount = $("#pickableCount");
const selectionStatus = $("#selectionStatus");
const summaryEmpty = $("#summaryEmpty");
const summaryResult = $("#summaryResult");
const hitsSection = $("#hitsSection");
const hitCount = $("#hitCount");
const pixelCount = $("#pixelCount");
const readLatency = $("#readLatency");
const auditProgress = $("#auditProgress");
const auditLine = $("#auditLine");
const hitManifestTag = $("#hitManifestTag");
const hitList = $("#hitList");
const guardTag = $("#guardTag");
const epochValue = $("#epochValue");
const requestValue = $("#requestValue");
const staleValue = $("#staleValue");
const guardCopy = $("#guardCopy");
const staleTestButton = $("#staleTestButton");
const actionList = $("#actionList");
const actionCount = $("#actionCount");
const replayButton = $("#replayButton");
const exportButton = $("#exportButton");
const clearButton = $("#clearButton");
const selectTool = $("#selectTool");
const orbitTool = $("#orbitTool");
const toolHint = $("#toolHint");
const cursorX = $("#cursorX");
const cursorY = $("#cursorY");
const readMode = $("#readMode");
const resetViewButton = $("#resetViewButton");
const frontViewButton = $("#frontViewButton");
const topViewButton = $("#topViewButton");

let viewer;
let engine;
let dragState = null;
let activeMode = "select";
let currentSelection = null;
let currentAction = null;
let actions = [];
let actionSerial = 0;
let toastTimer = 0;
let staleProbeRunning = false;
let lastProbe = null;

try {
  viewer = new Viewer(stage);
  engine = new IdSelectionEngine({
    viewer,
    onStale: handleStaleResult,
  });
} catch (error) {
  showFatalError(error);
  throw error;
}

pickableCount.textContent = `${engine.getDescriptors().length} IDs`;
const pickEntries = viewer.assembly.pickables;
$("#structuralCount").textContent = String(
  pickEntries.filter((entry) => !entry.instances && entry.kind !== "cutout").length,
);
$("#fastenerCount").textContent = String(
  pickEntries.find((entry) => entry.name === "Flange bolt M6")?.instances?.length ?? 0,
);
$("#finCount").textContent = String(
  pickEntries.find((entry) => entry.name === "Heat exchanger fin")?.instances?.length ?? 0,
);
$("#rollerCount").textContent = String(
  pickEntries.find((entry) => entry.name === "Bearing roller")?.instances?.length ?? 0,
);

viewer.onViewportChange((viewport) => {
  dprChip.textContent = `DPR ${viewport.pixelRatio.toFixed(1)}`;
  bufferChip.textContent = `${Math.round(viewport.drawingWidth)} × ${Math.round(
    viewport.drawingHeight,
  )}`;
  if (currentSelection) {
    currentSelection.viewportChanged = true;
    const freshRect = scaleCssRect(
      currentSelection.rectCss,
      { width: currentSelection.viewport.cssWidth, height: currentSelection.viewport.cssHeight },
      { width: viewport.cssWidth, height: viewport.cssHeight },
    );
    positionSelectionBox(freshRect, true);
    if (currentSelection.hits.length) {
      setStatus("viewport", "VIEWPORT");
      auditLine.textContent = "Viewport changed. Replay the action to resample the ID pass.";
      auditLine.className = "audit-line is-warning";
    }
  }
});

viewer.onViewportChange(updateDiagnostics);
viewer.onCameraChange((summary) => {
  cameraReadout.textContent = summary;
  updateDiagnostics();
});

const initialViewport = viewer.getViewportState();
dprChip.textContent = `DPR ${initialViewport.pixelRatio.toFixed(1)}`;
bufferChip.textContent = `${Math.round(initialViewport.drawingWidth)} × ${Math.round(
  initialViewport.drawingHeight,
)}`;
cameraReadout.textContent = viewer.getCameraSummary();
updateDiagnostics();
bindInteractions();
bindToolbar();
updateActionHistory();
updateToolMode("select");

function updateDiagnostics() {
  const stats = engine.getStats();
  epochValue.textContent = String(stats.epoch).padStart(4, "0");
  requestValue.textContent = String(stats.requestSeq).padStart(4, "0");
  staleValue.textContent = String(stats.staleDrops);
  readMode.textContent = stats.readMode;
  if (stats.staleDrops > 0) {
    guardTag.textContent = "GUARDED";
    guardTag.className = "tag warning";
  }
}

function showFatalError(error) {
  const panel = document.createElement("div");
  panel.className = "fatal-error";
  panel.innerHTML = `
    <strong>WebGL2 is required</strong>
    <span>${String(error.message || error)}</span>
  `;
  stage.appendChild(panel);
}

function bindInteractions() {
  const canvas = viewer.renderer.domElement;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activeMode !== "select") return;
    event.preventDefault();
    const point = getLocalPoint(event);
    dragState = {
      pointerId: event.pointerId,
      start: point,
      current: point,
    };
    canvas.setPointerCapture(event.pointerId);
    viewer.setControlsEnabled(false);
    dragPrompt.classList.add("is-hidden");
    selectionBox.classList.add("is-visible");
    selectionBox.classList.remove("is-resolving");
    positionSelectionBox(normalizeRect(point, point), true);
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = getLocalPoint(event);
    cursorX.textContent = point.x.toFixed(0).padStart(3, "0");
    cursorY.textContent = point.y.toFixed(0).padStart(3, "0");
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState.current = point;
    positionSelectionBox(normalizeRect(dragState.start, dragState.current), true);
  });

  const finishDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const point = getLocalPoint(event);
    dragState.current = point;
    const rawRect = normalizeRect(dragState.start, dragState.current);
    dragState = null;
    viewer.setControlsEnabled(true);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    const rect =
      rawRect.width < 4 || rawRect.height < 4
        ? pointSelectionRect(point)
        : rawRect;
    positionSelectionBox(rect, true);
    startResolutionAnimation();
    executeRectangle(rect);
  };

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState = null;
    viewer.setControlsEnabled(true);
    selectionBox.classList.remove("is-visible", "is-resolving");
    selectionBox.querySelector(".resolving-sweep")?.remove();
  });
  canvas.addEventListener("pointerleave", () => {
    if (!dragState) {
      cursorX.textContent = "—";
      cursorY.textContent = "—";
    }
  });
  stage.addEventListener("contextmenu", (event) => event.preventDefault());
}

function getLocalPoint(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  };
}

function pointSelectionRect(point) {
  return {
    x: Math.max(0, point.x - 3),
    y: Math.max(0, point.y - 3),
    width: 6,
    height: 6,
  };
}

function positionSelectionBox(rect, visible) {
  selectionBox.style.left = `${rect.x}px`;
  selectionBox.style.top = `${rect.y}px`;
  selectionBox.style.width = `${rect.width}px`;
  selectionBox.style.height = `${rect.height}px`;
  boxLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
  if (visible) selectionBox.classList.add("is-visible");
}

function startResolutionAnimation() {
  selectionBox.classList.add("is-resolving");
  if (!selectionBox.querySelector(".resolving-sweep")) {
    const sweep = document.createElement("span");
    sweep.className = "resolving-sweep";
    selectionBox.appendChild(sweep);
  }
}

function stopResolutionAnimation() {
  selectionBox.classList.remove("is-resolving");
  selectionBox.querySelector(".resolving-sweep")?.remove();
}

let selectionRunId = 0;

async function executeRectangle(rect, { replayAction = null } = {}) {
  const runId = ++selectionRunId;
  const camera = viewer.getCameraState();
  const viewport = viewer.getViewportState();
  setStatus("scanning", "SCANNING");
  auditLine.textContent = replayAction
    ? `Replaying ${replayAction.actionId} · restoring camera and ID pass.`
    : "Rendering object IDs and reading back visible fragments.";
  auditLine.className = "audit-line";

  const result = await engine.selectRectangle(rect);
  if (runId !== selectionRunId) return result;
  stopResolutionAnimation();
  updateDiagnostics();

  if (result.stale) {
    setStatus("warning", "STALE");
    auditLine.textContent =
      "An asynchronous readback was invalidated before it could be applied.";
    auditLine.className = "audit-line is-warning";
    showToast("STALE READBACK DROPPED · EPOCH CHANGED", true);
    window.setTimeout(() => {
      if (runId === selectionRunId) selectionBox.classList.remove("is-visible");
    }, 900);
    return result;
  }

  if (result.empty) {
    currentSelection = result;
    summaryEmpty.classList.add("is-hidden");
    summaryResult.classList.remove("is-hidden");
    hitCount.textContent = "0";
    pixelCount.textContent = "0";
    readLatency.textContent = "0.00";
    hitManifestTag.textContent = "0 VERIFIED";
    hitManifestTag.className = "tag warning";
    auditProgress.style.width = "0%";
    hitsSection.classList.add("is-collapsed");
    hitList.innerHTML = "";
    setStatus("idle", "NO HIT");
    auditLine.textContent = "The selection rectangle is empty.";
    auditLine.className = "audit-line";
    viewer.clearSelectionDescriptors();
    selectionBox.classList.remove("is-visible");
    return result;
  }

  applySelectionResult(result);
  if (replayAction) {
    verifyReplay(replayAction, result);
    return result;
  }

  const action = createAction(rect, camera, viewport, result);
  currentAction = action;
  updateActionHistory();
  return result;
}

function applySelectionResult(result) {
  currentSelection = result;
  summaryEmpty.classList.add("is-hidden");
  summaryResult.classList.remove("is-hidden");
  hitCount.textContent = String(result.hitCount);
  pixelCount.textContent = String(result.pixelCount);
  readLatency.textContent = result.readMs.toFixed(2);
  readMode.textContent = result.readMode;
  hitManifestTag.textContent = `${result.verifiedCount} VERIFIED`;
  hitManifestTag.className =
    result.hitCount > 0 && result.verifiedCount === result.hitCount
      ? "tag verified"
      : "tag warning";

  const progress = result.hitCount
    ? Math.round((result.verifiedCount / result.hitCount) * 100)
    : 0;
  auditProgress.style.width = `${progress}%`;
  hitsSection.classList.toggle("is-collapsed", result.hitCount === 0);

  if (result.hitCount === 0) {
    setStatus("idle", "NO HIT");
    auditLine.textContent = "The region contains no visible fragments from the pick registry.";
    auditLine.className = "audit-line";
  } else if (result.allVerified) {
    setStatus("ready", "VERIFIED");
    auditLine.textContent = `${result.verifiedCount}/${result.hitCount} IDs verified · ${result.readMode} readback · ${result.pixelCount} visible px.`;
    auditLine.className = "audit-line is-ok";
  } else {
    setStatus("warning", "REVIEW");
    auditLine.textContent = `${result.invalidPixels} pixels resolved to unregistered IDs. Inspect the manifest.`;
    auditLine.className = "audit-line is-warning";
  }

  renderHitList(result);
  viewer.setSelectionDescriptors(
    result.hits.filter((hit) => hit.verified).map((hit) => hit.descriptor),
  );
  selectionBox.classList.add("selection-flash");
  window.setTimeout(() => selectionBox.classList.remove("selection-flash"), 460);
  window.setTimeout(() => {
    if (currentSelection === result) selectionBox.classList.remove("is-visible");
  }, 760);
}

function renderHitList(result) {
  hitList.innerHTML = "";
  for (const hit of result.hits) {
    const row = document.createElement("div");
    row.className = `hit-row${hit.verified ? "" : " is-invalid"}`;
    row.title = `${hit.pickIdLabel} · ${hit.checks.codecRoundTrip ? "codec ok" : "codec failed"} · ${
      hit.checks.registryMatch ? "registry ok" : "registry failed"
    }`;
    row.innerHTML = `
      <span class="hit-swatch" style="background:${hit.color}"></span>
      <span class="hit-copy">
        <strong>${escapeHtml(hit.name)}</strong>
        <small>${hit.partId} · ${hit.pickIdLabel} · ${
          hit.instanceIndex === null ? escapeHtml(hit.category) : `INSTANCE ${hit.instanceIndex + 1}/${hit.instanceCount}`
        }</small>
      </span>
      <span class="hit-stat">
        <b>${hit.pixelCount} px</b>
        <span>${hit.verified ? "VERIFIED" : "INVALID ID"}</span>
      </span>
    `;
    hitList.appendChild(row);
  }
}

function createAction(rect, camera, viewport, result) {
  actionSerial += 1;
  const action = {
    actionId: `SEL-${String(actionSerial).padStart(3, "0")}`,
    createdAt: new Date().toISOString(),
    rectCss: {
      x: result.rectCss.x,
      y: result.rectCss.y,
      width: result.rectCss.width,
      height: result.rectCss.height,
    },
    normalizedRect: {
      x: result.rectCss.x / Math.max(1, result.viewport.cssWidth),
      y: result.rectCss.y / Math.max(1, result.viewport.cssHeight),
      width: result.rectCss.width / Math.max(1, result.viewport.cssWidth),
      height: result.rectCss.height / Math.max(1, result.viewport.cssHeight),
    },
    viewport,
    camera,
    fingerprint: result.fingerprint,
    result: serializeResult(result),
    replayCount: 0,
    lastReplay: null,
  };
  actions.push(action);
  if (actions.length > 20) actions.shift();
  replayButton.disabled = actions.length === 0;
  exportButton.disabled = false;
  return action;
}

function serializeResult(result) {
  return {
    requestId: result.requestId,
    epoch: result.epoch,
    rectCss: result.rectCss,
    viewport: result.viewport,
    bufferRect: result.bufferRect,
    pixelCount: result.pixelCount,
    invalidPixels: result.invalidPixels,
    hitCount: result.hitCount,
    verifiedCount: result.verifiedCount,
    allVerified: result.allVerified,
    fingerprint: result.fingerprint,
    readMode: result.readMode,
    readMs: result.readMs,
    completedAt: result.completedAt,
    hits: result.hits.map((hit) => ({
      pickId: hit.pickId,
      pickIdLabel: hit.pickIdLabel,
      partId: hit.partId,
      name: hit.name,
      partName: hit.partName,
      category: hit.category,
      kind: hit.kind,
      instanceIndex: hit.instanceIndex,
      instanceCount: hit.instanceCount,
      pixelCount: hit.pixelCount,
      sampleBuffer: hit.sampleBuffer,
      sampleCss: hit.sampleCss,
      verified: hit.verified,
      checks: hit.checks,
    })),
  };
}

function verifyReplay(action, result) {
  const diff = compareHitManifests(action.result.hits, result.hits);
  const viewportMatches =
    Math.abs(action.viewport.cssWidth - result.viewport.cssWidth) < 0.5 &&
    Math.abs(action.viewport.cssHeight - result.viewport.cssHeight) < 0.5 &&
    Math.abs(action.viewport.pixelRatio - result.viewport.pixelRatio) < 0.01;
  const idsMatch = diff.missing.length === 0 && diff.extra.length === 0;
  const exact = viewportMatches && diff.equal;

  action.replayCount += 1;
  action.lastReplay = {
    at: new Date().toISOString(),
    exact,
    idsMatch,
    missing: diff.missing,
    extra: diff.extra,
    pixelDeltas: diff.pixelDeltas,
    viewportMatches,
    hitCount: result.hitCount,
    pixelCount: result.pixelCount,
  };
  currentAction = action;
  updateActionHistory();

  if (exact) {
    setStatus("ready", "REPLAY EXACT");
    auditLine.textContent = `${result.hitCount}/${result.hitCount} IDs and pixel counts match ${action.actionId}.`;
    auditLine.className = "audit-line is-ok";
    showToast(`REPLAY VERIFIED · ${action.actionId} · ${result.hitCount} IDs`);
  } else if (idsMatch) {
    setStatus("ready", "REPLAY IDS");
    auditLine.textContent = `IDs match ${action.actionId}; ${diff.pixelDeltas.length} hit regions were resampled.`;
    auditLine.className = "audit-line";
    showToast(`REPLAY IDS MATCH · ${action.actionId} · PIXELS RESAMPLED`, true);
  } else {
    setStatus("warning", "REPLAY DIFF");
    const details = `${diff.missing.length} missing · ${diff.extra.length} extra`;
    auditLine.textContent = `Replay diverged from ${action.actionId} (${details}).`;
    auditLine.className = "audit-line is-warning";
    showToast(`REPLAY DIVERGENCE · ${details}`, true);
  }
}

function replayActionById(actionId) {
  const action = actions.find((item) => item.actionId === actionId);
  if (!action) return Promise.resolve(null);
  viewer.setCameraState(action.camera);
  const viewport = viewer.getViewportState();
  const rect = scaleCssRect(
    action.rectCss,
    { width: action.viewport.cssWidth, height: action.viewport.cssHeight },
    { width: viewport.cssWidth, height: viewport.cssHeight },
  );
  dragPrompt.classList.add("is-hidden");
  positionSelectionBox(rect, true);
  startResolutionAnimation();
  return executeRectangle(rect, { replayAction: action });
}

function updateActionHistory() {
  actionCount.textContent = String(actions.length);
  replayButton.disabled = actions.length === 0;
  exportButton.disabled = actions.length === 0;

  if (actions.length === 0) {
    actionList.innerHTML = '<p class="empty-note">Selections become replayable actions.</p>';
    return;
  }

  actionList.innerHTML = "";
  for (const action of [...actions].reverse()) {
    const row = document.createElement("div");
    row.className = "action-row";
    const replayStatus = action.lastReplay
      ? action.lastReplay.exact
        ? " · EXACT"
        : action.lastReplay.idsMatch
          ? " · IDS OK"
          : " · DIFF"
      : "";
    const time = new Date(action.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    row.innerHTML = `
      <span class="action-index">${action.actionId.replace("SEL-", "#")}</span>
      <span class="action-copy">
        <strong>Region ${action.result.hitCount} IDs · ${action.result.pixelCount} px</strong>
        <small>${time} · ${action.result.readMode}${replayStatus}</small>
      </span>
      <button class="replay-icon-button" type="button" title="Replay ${action.actionId}" aria-label="Replay ${action.actionId}">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.2 2.4h5.6v7.2H3.2z" fill="none" stroke="currentColor" stroke-width="1.1"/>
          <path d="M1.2 3.6v-2h2M10.8 8.4v2h-2" fill="none" stroke="currentColor" stroke-width="1.1"/>
        </svg>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => replayActionById(action.actionId));
    actionList.appendChild(row);
  }
}

function setStatus(kind, label) {
  selectionStatus.className = `status-pill ${kind}`;
  selectionStatus.textContent = label;
}

function showToast(message, warning = false) {
  window.clearTimeout(toastTimer);
  stageToast.textContent = message;
  stageToast.className = `stage-toast is-visible${warning ? " is-warning" : ""}`;
  toastTimer = window.setTimeout(() => {
    stageToast.classList.remove("is-visible");
  }, 2600);
}

function handleStaleResult(stale) {
  updateDiagnostics();
  guardTag.textContent = "GUARDED";
  guardTag.className = "tag warning";
  guardCopy.textContent = `Rejected request ${stale.requestId}: ${stale.reason}. Epoch ${stale.epoch} → ${stale.currentEpoch}.`;
  guardCopy.className = "guard-copy is-warning";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindToolbar() {
  selectTool.addEventListener("click", () => updateToolMode("select"));
  orbitTool.addEventListener("click", () => updateToolMode("orbit"));
  clearButton.addEventListener("click", clearSelection);
  replayButton.addEventListener("click", () => {
    const action = actions.at(-1);
    if (action) replayActionById(action.actionId);
  });
  exportButton.addEventListener("click", exportAudit);
  staleTestButton.addEventListener("click", runStaleProbe);
  resetViewButton.addEventListener("click", () => viewer.flyToPreset("iso"));
  frontViewButton.addEventListener("click", () => viewer.flyToPreset("front"));
  topViewButton.addEventListener("click", () => viewer.flyToPreset("top"));

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "b" || event.key === "B") updateToolMode("select");
    if (event.key === "o" || event.key === "O") updateToolMode("orbit");
    if (event.key === "Escape") clearSelection();
    if (event.key === "r" || event.key === "R") {
      const action = actions.at(-1);
      if (action) replayActionById(action.actionId);
    }
  });
}

function updateToolMode(mode) {
  activeMode = mode;
  dragState = null;
  viewer.setControlsEnabled(true);
  viewer.setInteractionMode(mode);
  selectTool.classList.toggle("is-active", mode === "select");
  orbitTool.classList.toggle("is-active", mode === "orbit");
  toolHint.textContent =
    mode === "select"
      ? "Drag to select visible fragments · right-drag to orbit"
      : "Left-drag to orbit · wheel to zoom · B returns to box select";
  dragPrompt.classList.toggle("is-hidden", mode === "orbit" || !!currentSelection);
  selectionBox.classList.remove("is-visible", "is-resolving");
  selectionBox.querySelector(".resolving-sweep")?.remove();
}

function clearSelection() {
  selectionRunId += 1;
  engine.invalidate("clear");
  dragState = null;
  currentSelection = null;
  currentAction = null;
  viewer.setControlsEnabled(true);
  viewer.clearSelectionDescriptors();
  summaryEmpty.classList.remove("is-hidden");
  summaryResult.classList.add("is-hidden");
  hitsSection.classList.add("is-collapsed");
  hitList.innerHTML = "";
  selectionBox.classList.remove("is-visible", "is-resolving");
  selectionBox.querySelector(".resolving-sweep")?.remove();
  dragPrompt.classList.toggle("is-hidden", activeMode === "orbit");
  auditProgress.style.width = "0%";
  setStatus("idle", "IDLE");
  updateDiagnostics();
}

async function runStaleProbe() {
  if (staleProbeRunning) return null;
  staleProbeRunning = true;
  staleTestButton.classList.add("is-running");
  staleTestButton.disabled = true;
  staleTestButton.innerHTML = '<span class="test-pulse"></span> Probe in flight…';
  guardTag.textContent = "TESTING";
  guardTag.className = "tag";
  guardCopy.textContent = "Issuing a readback, then invalidating camera state before the result is accepted.";
  guardCopy.className = "guard-copy";
  const savedCamera = viewer.getCameraState();
  const viewport = viewer.getViewportState();
  const rect = {
    x: Math.max(8, viewport.cssWidth * 0.33),
    y: Math.max(8, viewport.cssHeight * 0.28),
    width: Math.min(260, viewport.cssWidth * 0.34),
    height: Math.min(210, viewport.cssHeight * 0.34),
  };
  const epochBefore = engine.getStats().epoch;

  const probePromise = engine.selectRectangle(rect, { debugAfterReadDelayMs: 260 });
  await delay(90);
  const target = viewer.controls.target;
  const position = viewer.camera.position;
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  const angle = 0.022;
  position.x = target.x + dx * Math.cos(angle) - dz * Math.sin(angle);
  position.z = target.z + dx * Math.sin(angle) + dz * Math.cos(angle);
  viewer.camera.lookAt(target);
  viewer.emitCameraChange();

  const result = await probePromise;
  lastProbe = {
    at: new Date().toISOString(),
    expectedStale: true,
    stale: !!result.stale,
    reason: result.reason ?? null,
    epochBefore,
    epochAfter: engine.getStats().epoch,
    requestId: result.requestId,
  };
  updateDiagnostics();
  viewer.setCameraState(savedCamera);

  if (result.stale) {
    guardCopy.textContent = `Probe passed: request ${result.requestId} was discarded after readback (${result.reason}).`;
    guardCopy.className = "guard-copy is-warning";
    showToast("STALE READBACK PROBE PASSED · RESULT REJECTED");
    setStatus(currentSelection ? "ready" : "idle", currentSelection ? "VERIFIED" : "IDLE");
    auditLine.textContent = "Stale-result guard verified: invalidated readback was not applied.";
    auditLine.className = "audit-line is-warning";
  } else {
    guardCopy.textContent = "Probe completed without detecting a stale result. Increase the delay or inspect the guard.";
    guardCopy.className = "guard-copy is-warning";
    showToast("STALE PROBE INCONCLUSIVE", true);
  }

  staleProbeRunning = false;
  staleTestButton.disabled = false;
  staleTestButton.classList.remove("is-running");
  staleTestButton.innerHTML =
    '<span class="test-pulse"></span> Run stale-readback probe';
  return result;
}

function exportAudit() {
  const payload = {
    schema: "spectra.selection-audit/v1",
    exportedAt: new Date().toISOString(),
    model: {
      name: viewer.assembly.root.name,
      pickableIds: engine.getDescriptors().length,
      instancedParts: viewer.assembly.pickables
        .filter((entry) => entry.instances?.length)
        .map((entry) => ({
          name: entry.name,
          instances: entry.instances.length,
        })),
    },
    selectionRules: {
      occlusion: "depth-tested nearest fragment",
      alphaCutout: "fragment discarded when alphaMap.g < 0.5",
      displayLayers: "excluded from ID pass; transparent and non-occluding",
      idEncoding: "little-endian RGB24, 0 is empty",
    },
    diagnostics: {
      ...engine.getStats(),
      lastStaleProbe: lastProbe,
    },
    currentSelection: currentSelection ? serializeResult(currentSelection) : null,
    actions,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `spectra-selection-audit-${new Date()
    .toISOString()
    .replaceAll(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`AUDIT EXPORTED · ${actions.length} ACTIONS`);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

window.spectra = {
  viewer,
  engine,
  selectRect: async (rect) => {
    positionSelectionBox(rect, true);
    dragPrompt.classList.add("is-hidden");
    startResolutionAnimation();
    const result = await executeRectangle(rect);
    return result?.stale || result?.empty ? result : serializeResult(result);
  },
  replayAction: (actionId) => replayActionById(actionId),
  clearSelection,
  probeStale: runStaleProbe,
  getActions: () => JSON.parse(JSON.stringify(actions)),
  getSelection: () => (currentSelection ? serializeResult(currentSelection) : null),
  getDiagnostics: () => engine.getStats(),
  getRegistry: () =>
    engine.getDescriptors().map(({ sourceMesh, ...descriptor }) => descriptor),
};
