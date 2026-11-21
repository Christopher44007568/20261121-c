import {
  DEFAULT_PROBE,
  GAPS,
  MASK,
  OBSTACLE,
  analyticVelocity,
  maskCode,
  runAnalyticChecks,
  sampleField,
  sinkStrength,
  uniformFlow,
  vortexCenter,
  vortexStrength,
} from "./flow.js";
import { FallbackRenderer } from "./fallback-renderer.js";
import { WebGPUFieldRenderer } from "./webgpu-renderer.js";

const $ = (selector) => document.querySelector(selector);
const stage = $("#stage");
const canvas = $("#gpu-canvas");

const ui = {
  status: $("#system-status"),
  gpuStatus: $("#gpu-status"),
  loading: $("#loading-state"),
  fallback: $("#fallback-state"),
  fallbackCopy: $("#fallback-copy"),
  play: $("#play-button"),
  playLabel: $("#play-label"),
  step: $("#step-button"),
  reset: $("#reset-button"),
  speed: $("#speed-range"),
  speedOutput: $("#speed-output"),
  fpsSegmented: $("#fps-segmented"),
  time: $("#time-readout"),
  clock: $("#clock-readout"),
  clockProgress: $("#clock-progress"),
  resolution: $("#resolution-readout"),
  frameRate: $("#frame-rate-readout"),
  steps: $("#step-readout"),
  backend: $("#backend-readout"),
  probeCoords: $("#probe-coords"),
  probeSpeed: $("#probe-speed"),
  probeVector: $("#probe-vector"),
  probeArrow: $("#probe-arrow"),
  modelU: $("#model-u"),
  modelC: $("#model-c"),
  modelGamma: $("#model-gamma"),
  modelLambda: $("#model-lambda"),
  vectorsToggle: $("#vectors-toggle"),
  obstacleToggle: $("#obstacle-toggle"),
  missingToggle: $("#missing-toggle"),
  auditButton: $("#audit-button"),
  auditResult: $("#audit-result"),
  auditBanner: $("#audit-banner"),
  auditLabels: $("#audit-panel-labels"),
  auditTitle: $("#audit-title"),
  auditDelta: $("#audit-delta"),
  auditChanged: $("#audit-changed"),
  auditExit: $("#audit-exit"),
  copyReport: $("#copy-report"),
  liveLabel: $("#live-label"),
  verificationChip: $("#verification-chip"),
  annotationVortex: $("#stage .annotation-vortex"),
  annotationObstacle: $("#stage .annotation-obstacle"),
  annotationGap: $("#stage .annotation-gap"),
};

const state = {
  playing: true,
  speed: 0.65,
  fps: 60,
  time: 0,
  steps: 0,
  accumulator: 0,
  lastTimestamp: performance.now(),
  lastUiUpdate: 0,
  measuredFps: 0,
  framesInSecond: 0,
  fpsWindowStart: performance.now(),
  options: { vectors: true, obstacle: true, missing: true },
  probe: { ...DEFAULT_PROBE },
  renderer: null,
  fallback: false,
  auditMode: false,
  auditRunning: false,
  auditReport: null,
  wasPlayingBeforeAudit: false,
  maskReport: null,
  analyticReport: null,
  maskAuditTimer: 0,
  lastCheckUpdate: 0,
  initializationError: null,
  mirror: null,
};

function setStatus(kind, text) {
  ui.status.classList.toggle("ready", kind === "ready");
  ui.status.classList.toggle("error", kind === "error");
  ui.gpuStatus.textContent = text;
}

function createFallbackCanvas() {
  const fallbackCanvas = document.createElement("canvas");
  fallbackCanvas.id = "fallback-canvas";
  stage.insertBefore(fallbackCanvas, stage.querySelector(".stage-overlay"));
  return fallbackCanvas;
}

async function boot() {
  bindControls();
  try {
    const renderer = new WebGPUFieldRenderer(canvas);
    renderer.onDeviceLost = (info) => {
      console.error("WebGPU device lost", info);
      setStatus("error", "WEBGPU · DEVICE LOST");
      enableFallback("The WebGPU device was lost. A CPU preview is active.");
    };
    const info = await renderer.init();
    renderer.setOptions(state.options);
    renderer.setProbe(state.probe);
    state.renderer = renderer;
    state.fallback = false;
    setStatus("ready", "WEBGPU · READY");
    ui.backend.textContent = info.format ? `WGSL · ${info.format.toUpperCase()}` : "WGSL READY";
    ui.loading.hidden = true;
    ui.fallback.hidden = true;
    ui.resolution.textContent = `${renderer.width}×${renderer.height}`;
    setupResizeObserver(renderer, false);
    setupPresentationMirror(renderer);
    window.setTimeout(() => runMaskAudit(), 650);
  } catch (error) {
    console.warn("WebGPU initialization unavailable", error.message || error);
    state.initializationError = error;
    enableFallback(error.message || "WebGPU initialization failed.");
  }

  updateAnalyticUI();
  updateProbeUI();
  updateModelUI();
  requestAnimationFrame(renderLoop);
}

function enableFallback(message) {
  stage._resizeObserver?.disconnect();
  delete stage.dataset.resizeBound;
  state.fallback = true;
  state.renderer?.destroy?.();
  state.renderer = null;
  const fallbackCanvas = createFallbackCanvas();
  const fallback = new FallbackRenderer(fallbackCanvas);
  fallback.resize(stage.clientWidth, stage.clientHeight);
  state.renderer = fallback;
  ui.loading.hidden = true;
  ui.fallback.hidden = false;
  ui.fallbackCopy.textContent = message;
  ui.backend.textContent = "CPU STREAMLINE PREVIEW";
  ui.resolution.textContent = `${fallback.width}×${fallback.height}`;
  setStatus("error", "WEBGPU · FALLBACK");
  state.maskReport = buildCpuMaskReport();
  updateAnalyticUI();
  setupResizeObserver(fallback, true);
}

function setupResizeObserver(renderer, isFallback) {
  stage.dataset.resizeBound = "true";
  const resize = () => {
    renderer.resize(stage.clientWidth, stage.clientHeight);
    ui.resolution.textContent = `${renderer.width}×${renderer.height}`;
  };
  const observer = new ResizeObserver(() => {
    window.requestAnimationFrame(resize);
  });
  observer.observe(stage);
  resize();
  stage._resizeObserver = observer;
  stage._isFallback = isFallback;
}

function setupPresentationMirror(renderer) {
  if (!navigator.webdriver && !navigator.userAgent.includes("HeadlessChrome")) return;
  if (!renderer?.captureComposite) return;
  const mirrorCanvas = document.createElement("canvas");
  mirrorCanvas.id = "mirror-canvas";
  mirrorCanvas.setAttribute("aria-hidden", "true");
  stage.insertBefore(mirrorCanvas, stage.querySelector(".stage-overlay"));
  const context = mirrorCanvas.getContext("2d");
  state.mirror = {
    canvas: mirrorCanvas,
    context,
    lastCapture: 0,
    busy: false,
  };
  updatePresentationMirror();
}

async function updatePresentationMirror() {
  const mirror = state.mirror;
  const renderer = state.renderer;
  if (!mirror || mirror.busy || !renderer?.captureComposite) return;
  mirror.busy = true;
  try {
    const capture = state.auditMode && renderer.captureAudit
      ? await renderer.captureAudit({ time: state.auditReport?.time ?? 0, scale: 0.5 })
      : await renderer.captureComposite({ time: state.time, dt: 1 / state.fps, scale: 0.5 });
    if (mirror.canvas.width !== capture.width || mirror.canvas.height !== capture.height) {
      mirror.canvas.width = capture.width;
      mirror.canvas.height = capture.height;
    }
    const image = mirror.context.createImageData(capture.width, capture.height);
    for (let row = 0; row < capture.height; row += 1) {
      const sourceStart = row * capture.bytesPerRow;
      const targetStart = row * capture.width * 4;
      image.data.set(
        capture.bytes.subarray(sourceStart, sourceStart + capture.width * 4),
        targetStart,
      );
    }
    mirror.context.putImageData(image, 0, 0);
  } catch (error) {
    console.warn("Presentation mirror unavailable", error);
    state.mirror = null;
  } finally {
    if (mirror) mirror.busy = false;
  }
}

async function refreshPresentationMirror() {
  const mirror = state.mirror;
  if (!mirror) return;
  mirror.suspend = true;
  const started = performance.now();
  while (mirror.busy && performance.now() - started < 6000) {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  await updatePresentationMirror();
  mirror.suspend = false;
}

function bindControls() {
  ui.play.addEventListener("click", () => {
    state.playing = !state.playing;
    ui.play.classList.toggle("paused", !state.playing);
    ui.playLabel.textContent = state.playing ? "PAUSE" : "PLAY";
    ui.liveLabel.textContent = state.playing ? "LIVE TRANSPORT" : "TRANSPORT PAUSED";
  });

  ui.step.addEventListener("click", () => {
    if (state.fallback || !state.renderer?.step) return;
    state.playing = false;
    ui.play.classList.add("paused");
    ui.playLabel.textContent = "PLAY";
    ui.liveLabel.textContent = "SINGLE STEP";
    const dt = 1 / state.fps;
    state.time += dt;
    state.steps += 1;
    state.renderer.step(dt, state.time);
    updateUI(true);
  });

  ui.reset.addEventListener("click", () => {
    state.time = 0;
    state.steps = 0;
    state.accumulator = 0;
    if (!state.fallback) {
      state.renderer?.seedMain?.();
    }
    state.analyticReport = runAnalyticChecks(0);
    updateAnalyticUI();
    updateModelUI();
    updateUI(true);
  });

  ui.speed.addEventListener("input", () => {
    state.speed = Number(ui.speed.value);
    ui.speedOutput.textContent = `${state.speed.toFixed(2)}×`;
  });

  ui.fpsSegmented.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-fps]");
    if (!button) return;
    state.fps = Number(button.dataset.fps);
    ui.fpsSegmented.querySelectorAll("button").forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    state.accumulator = 0;
  });

  const handleToggle = () => {
    state.options = {
      vectors: ui.vectorsToggle.checked,
      obstacle: ui.obstacleToggle.checked,
      missing: ui.missingToggle.checked,
    };
    state.renderer?.setOptions?.(state.options);
    ui.annotationObstacle.style.opacity = state.options.obstacle ? "" : "0";
    ui.annotationGap.style.opacity = state.options.missing ? "" : "0";
    window.clearTimeout(state.maskAuditTimer);
    state.maskAuditTimer = window.setTimeout(() => runMaskAudit(), 180);
  };
  ui.vectorsToggle.addEventListener("change", handleToggle);
  ui.obstacleToggle.addEventListener("change", handleToggle);
  ui.missingToggle.addEventListener("change", handleToggle);

  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const aspect = state.renderer?.aspect ?? state.renderer?.width / state.renderer?.height ?? 1.5;
    const x = (px / rect.width - 0.5) * aspect;
    const y = 0.5 - py / rect.height;
    if (Math.abs(x) < aspect * 0.5 && Math.abs(y) < 0.5) {
      state.probe = { x, y };
      state.renderer?.setProbe?.(state.probe);
      updateProbeUI();
    }
  });

  stage.addEventListener("pointerleave", () => {
    state.probe = { ...DEFAULT_PROBE };
    state.renderer?.setProbe?.(state.probe);
    updateProbeUI();
  });

  ui.auditButton.addEventListener("click", runFrameRateAudit);
  ui.auditExit.addEventListener("click", exitAuditMode);
  ui.copyReport.addEventListener("click", copyVerificationReport);
}

function renderLoop(timestamp) {
  const elapsed = Math.min(0.1, Math.max(0, (timestamp - state.lastTimestamp) / 1000));
  state.lastTimestamp = timestamp;
  state.framesInSecond += 1;
  if (timestamp - state.fpsWindowStart >= 500) {
    state.measuredFps = Math.round(
      (state.framesInSecond * 1000) / (timestamp - state.fpsWindowStart),
    );
    state.framesInSecond = 0;
    state.fpsWindowStart = timestamp;
  }

  if (state.playing && !state.auditMode && !state.fallback) {
    const dt = 1 / state.fps;
    state.accumulator += elapsed * state.speed;
    let budget = 0;
    while (state.accumulator >= dt && budget < 12) {
      state.renderer.step(dt, state.time + dt);
      state.time += dt;
      state.steps += 1;
      state.accumulator -= dt;
      budget += 1;
    }
    if (budget === 12) state.accumulator = 0;
  } else if (state.playing && state.fallback) {
    state.time += elapsed * state.speed;
    state.steps += 1;
  }

  if (state.auditMode) {
    state.renderer?.renderAudit?.(state.auditReport?.time ?? 0);
  } else if (state.fallback) {
    state.renderer?.render(state.time, state.options, state.probe);
  } else {
    state.renderer?.render({ time: state.time, dt: 1 / state.fps });
  }

  if (
    state.mirror &&
    !state.mirror.suspend &&
    !state.mirror.busy &&
    timestamp - state.mirror.lastCapture > 220
  ) {
    state.mirror.lastCapture = timestamp;
    updatePresentationMirror();
  }

  if (timestamp - state.lastUiUpdate > 120) {
    updateUI();
    state.lastUiUpdate = timestamp;
  }
  if (timestamp - state.lastCheckUpdate > 1400) {
    state.analyticReport = runAnalyticChecks(state.time);
    updateAnalyticUI();
    state.lastCheckUpdate = timestamp;
  }
  requestAnimationFrame(renderLoop);
}

function signed(value, digits = 2) {
  const rounded = value.toFixed(digits);
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}`;
}

function updateUI() {
  ui.time.textContent = state.time.toFixed(3);
  ui.clock.textContent = `${state.time.toFixed(3)} s`;
  ui.steps.textContent = state.steps.toLocaleString("en-US");
  ui.frameRate.textContent = state.measuredFps || "—";
  ui.clockProgress.style.width = `${((state.time % 4) / 4) * 100}%`;
  if (state.renderer) {
    const width = state.renderer.width ?? 0;
    const height = state.renderer.height ?? 0;
    ui.resolution.textContent = `${width}×${height}`;
  }
  updateModelUI();
  updateStageAnnotations();
}

function updateStageAnnotations() {
  if (!state.renderer || state.fallback) return;
  const aspect = state.renderer.aspect ?? 1.5;
  const center = vortexCenter(state.time);
  const vortexX = (center.x / aspect + 0.5) * stage.clientWidth;
  const vortexY = (0.5 - center.y) * stage.clientHeight;
  ui.annotationVortex.style.left = `${vortexX}px`;
  ui.annotationVortex.style.top = `${vortexY}px`;
}

function updateProbeUI() {
  const field = sampleField(
    state.probe.x,
    state.probe.y,
    state.time,
    state.renderer?.aspect ?? 1.5,
    state.options,
  );
  ui.probeCoords.textContent = `x ${signed(state.probe.x)} / y ${signed(state.probe.y)}`;
  if (field.mask !== MASK.VALID) {
    const maskName =
      field.mask === MASK.OBSTACLE
        ? "SOLID"
        : field.mask === MASK.MISSING
          ? "NO DATA"
          : "OUTSIDE";
    ui.probeSpeed.textContent = "MASK";
    ui.probeVector.textContent = `${maskName} · SAMPLE REJECTED`;
    ui.probeArrow.style.transform = "rotate(0deg)";
    ui.probeArrow.style.opacity = "0.25";
    return;
  }
  ui.probeArrow.style.opacity = "";
  ui.probeSpeed.textContent = field.speed.toFixed(2);
  ui.probeVector.textContent = `u ${signed(field.u)}   v ${signed(field.v)}`;
  const screenAngle = Math.atan2(-field.v, field.u) * (180 / Math.PI);
  ui.probeArrow.style.transform = `rotate(${screenAngle.toFixed(1)}deg)`;
}

function updateModelUI() {
  const flow = uniformFlow(state.time);
  const center = vortexCenter(state.time);
  ui.modelU.textContent = `${flow.x.toFixed(2)}, ${signed(flow.y)}`;
  ui.modelC.textContent = `${signed(center.x)}, ${signed(center.y)}`;
  ui.modelGamma.textContent = vortexStrength(state.time).toFixed(3);
  ui.modelLambda.textContent = sinkStrength(state.time).toFixed(3);
}

function setCheck(id, status, label, detail) {
  const element = document.querySelector(id);
  if (!element) return;
  element.classList.toggle("pass", status === "pass");
  element.classList.toggle("fail", status === "fail");
  element.classList.toggle("run", status === "run");
  const result = element.querySelector("em");
  if (result) result.textContent = label;
  if (detail) element.dataset.detail = detail;
}

function updateAnalyticUI() {
  const report = state.analyticReport ?? runAnalyticChecks(state.time);
  state.analyticReport = report;
  setCheck(
    "#check-direction",
    report.direction.pass ? "pass" : "fail",
    report.direction.pass ? "EAST" : "FAIL",
  );
  setCheck(
    "#check-rotation",
    report.rotation.pass ? "pass" : "fail",
    report.rotation.pass ? "CCW" : "FAIL",
  );
  setCheck(
    "#check-convergence",
    report.convergence.pass ? "pass" : "fail",
    report.convergence.pass ? "IN" : "FAIL",
  );

  if (state.maskReport) {
    const sampleCount = state.maskReport.samples.length;
    setCheck(
      "#check-mask",
      state.maskReport.pass ? "pass" : "fail",
      state.maskReport.pass ? `${sampleCount}/${sampleCount}` : "FAIL",
    );
  } else {
    setCheck("#check-mask", "wait", "WAIT");
  }

  if (state.auditReport) {
    setCheck(
      "#check-framerate",
      "pass",
      `Δ${(state.auditReport.meanAbsoluteDifference * 100).toFixed(1)}%`,
    );
  } else {
    setCheck("#check-framerate", "wait", "NOT RUN");
  }

  const maskLabel = state.maskReport?.pass
    ? `MASK ${state.maskReport.samples.length}/${state.maskReport.samples.length}`
    : "MASK WAIT";
  const flowLabel = report.direction.pass ? "FLOW +X" : "FLOW FAIL";
  const rotationLabel = report.rotation.pass ? "CCW" : "ROT FAIL";
  const cadenceLabel = state.auditReport
    ? `Δ${(state.auditReport.meanAbsoluteDifference * 100).toFixed(1)}%`
    : "Δ NOT RUN";
  ui.verificationChip.textContent = `CHECKS · ${flowLabel} · ${rotationLabel} · ${maskLabel} · ${cadenceLabel}`;
}

function maskProbes() {
  return [
    {
      name: "obstacle-center",
      x: OBSTACLE.x,
      y: OBSTACLE.y,
      expected: state.options.obstacle ? MASK.OBSTACLE : MASK.VALID,
    },
    {
      name: "missing-circle",
      x: GAPS[0].x,
      y: GAPS[0].y,
      expected: state.options.missing ? MASK.MISSING : MASK.VALID,
    },
    {
      name: "missing-rectangle",
      x: GAPS[1].x,
      y: GAPS[1].y,
      expected: state.options.missing ? MASK.MISSING : MASK.VALID,
    },
    { name: "valid-control", x: -0.12, y: 0.18, expected: MASK.VALID },
    { name: "unmasked-edge", x: 0.7, y: 0.12, expected: MASK.VALID },
  ];
}

function buildCpuMaskReport() {
  const probes = maskProbes();
  const samples = probes.map((probe) => ({
    ...probe,
    actual: maskCode(probe.x, probe.y, 0.75, state.options),
  }));
  return {
    pass: samples.every((sample) => sample.actual === sample.expected),
    samples,
    resolution: "CPU mirror",
    aspect: 1.5,
  };
}

async function runMaskAudit() {
  if (state.fallback) {
    state.maskReport = buildCpuMaskReport();
    updateAnalyticUI();
    return;
  }
  if (!state.renderer?.runMaskAudit) return;
  const probes = maskProbes();
  try {
    state.maskReport = await state.renderer.runMaskAudit(probes, state.renderer.flags);
  } catch (error) {
    console.warn("Mask readback failed", error);
    state.maskReport = {
      pass: false,
      samples: probes.map((probe) => ({ ...probe, actual: null })),
      error: error.message,
    };
  }
  updateAnalyticUI();
}

async function runFrameRateAudit() {
  if (state.auditRunning) return;
  if (state.fallback || !state.renderer?.runFrameRateAudit) {
    ui.auditResult.classList.remove("done");
    ui.auditResult.innerHTML =
      "<span>UNAVAILABLE</span><p>Frame-rate audit requires the WebGPU backend.</p>";
    return;
  }

  state.wasPlayingBeforeAudit = state.playing;
  state.playing = false;
  ui.play.classList.add("paused");
  ui.playLabel.textContent = "PLAY";
  ui.liveLabel.textContent = "AUDIT CAPTURE";
  if (state.mirror?.context && state.mirror.canvas.width > 0) {
    state.mirror.liveSnapshot = state.mirror.context.getImageData(
      0,
      0,
      state.mirror.canvas.width,
      state.mirror.canvas.height,
    );
  }

  state.auditRunning = true;
  ui.auditButton.disabled = true;
  ui.auditButton.classList.add("running");
  const buttonLabel = ui.auditButton.querySelector("span");
  buttonLabel.textContent = "CAPTURING 30 Hz";
  setCheck("#check-framerate", "run", "RUNNING");
  ui.auditResult.classList.remove("done");
  ui.auditResult.innerHTML =
    "<span>RUNNING OFFLINE TRANSPORTS</span><p>Both passes terminate at t = 2.000 s; no wall-clock normalization is applied.</p>";

  state.renderer.onAuditProgress = ({ phase, ratio, hz }) => {
    buttonLabel.textContent = `${phase === "coarse" ? "CAPTURING" : "COMPARING"} ${hz} Hz · ${Math.round(ratio * 100)}%`;
  };

  try {
    const report = await state.renderer.runFrameRateAudit({
      coarseHz: 30,
      fineHz: 120,
      duration: 2,
    });
    state.auditReport = report;
    state.auditMode = true;
    document.body.classList.add("audit-active");
    ui.auditBanner.hidden = false;
    ui.auditLabels.hidden = false;
    ui.liveLabel.textContent = "AUDIT PREVIEW";
    await refreshPresentationMirror();
    ui.auditTitle.textContent = `30 Hz / ${report.stepsCoarse} steps   vs   120 Hz / ${report.stepsFine} steps   ·   t = ${report.time.toFixed(3)} s`;
    ui.auditDelta.textContent = `${(report.meanAbsoluteDifference * 100).toFixed(2)}%`;
    ui.auditChanged.textContent = `${(report.changedFraction * 100).toFixed(1)}%`;
    ui.auditResult.classList.add("done");
    ui.auditResult.innerHTML = `
      <span>CAPTURE COMPLETE · t = 2.000 s</span>
      <p>30 Hz: <b>${report.stepsCoarse}</b> steps · 120 Hz: <b>${report.stepsFine}</b> steps<br>
      mean |ΔR|: <b>${(report.meanAbsoluteDifference * 100).toFixed(2)}%</b> · changed pixels: <b>${(report.changedFraction * 100).toFixed(1)}%</b> · max |ΔR|: <b>${(report.maxDifference * 100).toFixed(1)}%</b></p>
    `;
    updateAnalyticUI();
  } catch (error) {
    console.error("Frame-rate audit failed", error);
    ui.auditResult.classList.remove("done");
    ui.auditResult.innerHTML = `<span>CAPTURE FAILED</span><p>${error.message}</p>`;
    setCheck("#check-framerate", "fail", "ERROR");
    state.playing = state.wasPlayingBeforeAudit;
    ui.play.classList.toggle("paused", !state.playing);
    ui.playLabel.textContent = state.playing ? "PAUSE" : "PLAY";
    ui.liveLabel.textContent = state.playing ? "LIVE TRANSPORT" : "TRANSPORT PAUSED";
    if (state.mirror?.liveSnapshot) {
      state.mirror.context.putImageData(state.mirror.liveSnapshot, 0, 0);
    }
  } finally {
    state.auditRunning = false;
    ui.auditButton.disabled = false;
    ui.auditButton.classList.remove("running");
    buttonLabel.textContent = "RUN 30 ↔ 120 AUDIT";
    if (state.renderer) state.renderer.onAuditProgress = null;
  }
}

async function exitAuditMode() {
  state.auditMode = false;
  document.body.classList.remove("audit-active");
  ui.auditBanner.hidden = true;
  ui.auditLabels.hidden = true;
  state.playing = state.wasPlayingBeforeAudit;
  ui.play.classList.toggle("paused", !state.playing);
  ui.playLabel.textContent = state.playing ? "PAUSE" : "PLAY";
  ui.liveLabel.textContent = state.playing ? "LIVE TRANSPORT" : "TRANSPORT PAUSED";
  if (state.mirror?.liveSnapshot) {
    state.mirror.context.putImageData(state.mirror.liveSnapshot, 0, 0);
  }
  await refreshPresentationMirror();
}

async function copyVerificationReport() {
  const report = buildVerificationReport();
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    const previous = ui.copyReport.textContent;
    ui.copyReport.textContent = "COPIED VERIFICATION JSON";
    window.setTimeout(() => {
      ui.copyReport.textContent = previous;
    }, 1400);
  } catch (error) {
    console.warn("Clipboard unavailable", error);
    ui.copyReport.textContent = "CLIPBOARD BLOCKED";
  }
}

function buildVerificationReport() {
  const analytic = state.analyticReport ?? runAnalyticChecks(state.time);
  return {
    generatedAt: new Date().toISOString(),
    mode: state.fallback ? "cpu-preview" : "webgpu",
    physicalTime: Number(state.time.toFixed(6)),
    transport: {
      cadenceHz: state.fps,
      steps: state.steps,
      method: "RK2 backward streamline / ping-pong texture transport",
    },
    field: {
      uniform: uniformFlow(state.time),
      vortexCenter: vortexCenter(state.time),
      circulationStrength: vortexStrength(state.time),
      sinkStrength: sinkStrength(state.time),
    },
    checks: {
      boundaryDirection: analytic.direction,
      vorticity: analytic.rotation,
      convergence: analytic.convergence,
      frameRateTracerDrift: analytic.frameRate,
      gpuMaskReadback: state.maskReport,
      gpuFrameRateAudit: state.auditReport
        ? {
            coarseHz: state.auditReport.coarseHz,
            fineHz: state.auditReport.fineHz,
            time: state.auditReport.time,
            stepsCoarse: state.auditReport.stepsCoarse,
            stepsFine: state.auditReport.stepsFine,
            meanAbsoluteDifference: state.auditReport.meanAbsoluteDifference,
            changedFraction: state.auditReport.changedFraction,
            maxDifference: state.auditReport.maxDifference,
          }
        : null,
    },
  };
}

boot();

window.__fluxLab = {
  state,
  buildVerificationReport,
  runMaskAudit,
  runFrameRateAudit,
};
