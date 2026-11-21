import { buildScene } from "./geometry.js";
import { cameraEye, clamp, projectionMatrix } from "./math.js";
import { TechnicalRenderer } from "./renderer.js";
import { MeasurementOverlay } from "./measurement.js";

const scene = buildScene();
const root = document.documentElement;
const stage = document.querySelector("#stage");
const sceneCanvas = document.querySelector("#scene");
const measureCanvas = document.querySelector("#measure-layer");
const labelLayer = document.querySelector("#label-layer");
const renderer = new TechnicalRenderer(sceneCanvas);
const camera = { ...scene.camera };
const measurement = new MeasurementOverlay(scene, {
  canvas: measureCanvas,
  layer: labelLayer,
});

const elements = {
  dpr: document.querySelector("#dpr-status"),
  model: document.querySelector("#metric-model"),
  labels: document.querySelector("#metric-labels"),
  occlusion: document.querySelector("#metric-occlusion"),
  viewport: document.querySelector("#metric-viewport"),
  statusMeasures: document.querySelector("#status-measures"),
  statusCamera: document.querySelector("#status-camera"),
  statusProbe: document.querySelector("#status-probe"),
};

const state = {
  width: 1,
  height: 1,
  dpr: 1,
  targetRadius: camera.radius,
  targetAzimuth: camera.azimuth,
  targetElevation: camera.elevation,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  probe: null,
  lastProbeTime: -Infinity,
  lastReport: null,
  frame: 0,
  frameWaiters: [],
  zooming: false,
  initialProbe: false,
};

function resize() {
  const bounds = stage.getBoundingClientRect();
  state.width = Math.max(1, Math.round(bounds.width));
  state.height = Math.max(1, Math.round(bounds.height));
  state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  renderer.resize(state.width, state.height, state.dpr);
  measurement.resize(state.width, state.height, state.dpr);
  elements.dpr.textContent = `DPR ${state.dpr.toFixed(1)} · ${Math.round(state.width * state.dpr)}×${Math.round(state.height * state.dpr)}`;
  state.lastProbeTime = -Infinity;
}

function currentViewProjection() {
  camera.eye = cameraEye(camera);
  const viewProjection = projectionMatrix(camera, state.width / state.height);
  return viewProjection;
}

function frameLoop(time) {
  const movingCamera =
    Math.abs(camera.radius - state.targetRadius) > 0.001 ||
    Math.abs(camera.azimuth - state.targetAzimuth) > 0.01 ||
    Math.abs(camera.elevation - state.targetElevation) > 0.01;
  if (movingCamera) {
    camera.radius += (state.targetRadius - camera.radius) * 0.2;
    camera.azimuth += (state.targetAzimuth - camera.azimuth) * 0.28;
    camera.elevation += (state.targetElevation - camera.elevation) * 0.28;
  } else {
    camera.radius = state.targetRadius;
    camera.azimuth = state.targetAzimuth;
    camera.elevation = state.targetElevation;
  }
  state.zooming = Math.abs(camera.radius - state.targetRadius) > 0.02;

  const viewProjection = currentViewProjection();
  renderer.render(scene, camera, viewProjection);

  const probeDue =
    !state.probe ||
    (!state.dragging && time - state.lastProbeTime > (state.zooming ? 64 : 96)) ||
    (!state.initialProbe && time > 0);
  if (probeDue) {
    state.probe = renderer.probeDepth(scene, camera, viewProjection);
    state.lastProbeTime = time;
    state.initialProbe = true;
  }

  const report = measurement.update(viewProjection, camera, state.probe, {
    zooming: state.zooming,
  });
  state.lastReport = report;
  updateReadouts(report);
  updateStatus();
  state.frame += 1;
  state.frameWaiters = state.frameWaiters.filter((waiter) => {
    if (state.frame < waiter.target) return true;
    waiter.resolve();
    return false;
  });
  requestAnimationFrame(frameLoop);
}

function updateReadouts(report) {
  const modelGap = report.minModelGap ?? 0;
  const labelGap = report.minLabelGap;
  const viewport = report.minViewportGap;
  const dpr = state.dpr;
  elements.model.textContent = `${format(modelGap)} px / ${format(modelGap * dpr)} dp`;
  elements.labels.textContent = Number.isFinite(labelGap)
    ? `${format(labelGap)} px / ${format(labelGap * dpr)} dp`
    : "—";
  elements.viewport.textContent = Number.isFinite(viewport)
    ? `${format(viewport)} px / ${format(viewport * dpr)} dp`
    : "—";
  const m1 = report.measurements.M1;
  const m2 = report.measurements.M2;
  elements.occlusion.textContent =
    `${m1.segments.length + m2.segments.length} 段 / ` +
    `M2:${Math.round(m2.hiddenRatio * 100)}% M1:${Math.round(m1.hiddenRatio * 100)}%`;
}

function updateStatus() {
  elements.statusMeasures.textContent = "M2 1.800 mm / M1 14.000 mm";
  elements.statusCamera.textContent = `AZ ${Math.round(camera.azimuth)}° / EL ${Math.round(camera.elevation)}°`;
  elements.statusProbe.textContent = "DEPTH PROBED · SCREEN SPACE";
}

function format(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function zoomBy(factor) {
  state.targetRadius = clamp(state.targetRadius * factor, 12, 74);
}

function fitView() {
  state.targetRadius = 34;
  state.targetAzimuth = 36;
  state.targetElevation = 22;
}

function pointers(event) {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

sceneCanvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  state.dragging = true;
  const point = pointers(event);
  state.pointerX = point.x;
  state.pointerY = point.y;
  sceneCanvas.setPointerCapture(event.pointerId);
  sceneCanvas.style.cursor = "grabbing";
});

sceneCanvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const point = pointers(event);
  const dx = point.x - state.pointerX;
  const dy = point.y - state.pointerY;
  state.pointerX = point.x;
  state.pointerY = point.y;
  state.targetAzimuth = ((state.targetAzimuth - dx * 0.32) % 360 + 360) % 360;
  state.targetElevation = clamp(state.targetElevation + dy * 0.24, 7, 68);
});

function endDrag() {
  state.dragging = false;
  sceneCanvas.style.cursor = "grab";
}

sceneCanvas.addEventListener("pointerup", endDrag);
sceneCanvas.addEventListener("pointercancel", endDrag);
sceneCanvas.addEventListener("pointerleave", (event) => {
  if (event.buttons === 0) endDrag();
});

sceneCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    zoomBy(Math.exp(event.deltaY * 0.00125));
  },
  { passive: false },
);

sceneCanvas.addEventListener("dblclick", fitView);
sceneCanvas.style.cursor = "grab";

document.querySelector("[data-action='zoom-in']").addEventListener("click", () => zoomBy(0.8));
document.querySelector("[data-action='zoom-out']").addEventListener("click", () => zoomBy(1.25));
document.querySelector("[data-action='fit']").addEventListener("click", fitView);

window.addEventListener("resize", resize);
if ("ResizeObserver" in window) new ResizeObserver(resize).observe(stage);

function waitForFrame(count = 1) {
  const target = state.frame + Math.max(1, count);
  return new Promise((resolve) => state.frameWaiters.push({ target, resolve }));
}

function labelWhitespace(probe, report) {
  const modelGaps = report.labels.map((label) => {
    const rect = label.rect;
    const x0 = clamp(Math.floor(rect.x), 0, probe.width - 1);
    const x1 = clamp(Math.ceil(rect.x + rect.width), 0, probe.width - 1);
    const y0 = clamp(Math.floor(rect.y), 0, probe.height - 1);
    const y1 = clamp(Math.ceil(rect.y + rect.height), 0, probe.height - 1);
    let minimum = 9999;
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        minimum = Math.min(minimum, probe.distanceField[y * probe.width + x]);
      }
    }
    return Math.max(0, minimum - 0.75);
  });
  const minModelGap = Math.min(...modelGaps);
  return {
    minModelGapCss: minModelGap,
    minModelGapDevice: minModelGap * state.dpr,
    minLabelGapCss: report.minLabelGap,
    minLabelGapDevice: report.minLabelGap * state.dpr,
    minViewportGapCss: report.minViewportGap,
    minViewportGapDevice: report.minViewportGap * state.dpr,
  };
}

function snapshot() {
  const report = state.lastReport;
  if (!report) return null;
  const whitespace = labelWhitespace(state.probe, report);
  const distances = Object.fromEntries(
    measurement.measurements.map((item) => [item.id, item.distance]),
  );
  const occlusion = {
    hiddenPx: report.measurements.M1.hiddenPx + report.measurements.M2.hiddenPx,
    hiddenRatio: report.measurements.M1.hiddenRatio,
    segments: report.measurements.M1.segments,
    byDimension: report.measurements,
    rawSegmentCount: report.measurements.M1.hiddenSamples,
  };
  return {
    dpr: state.dpr,
    framebuffer: `${Math.round(state.width * state.dpr)}x${Math.round(state.height * state.dpr)}`,
    cssViewport: `${state.width}x${state.height}`,
    worldDistances: distances,
    labels: report.labels,
    labelWhitespace: whitespace,
    finalLabelWhitespace: whitespace,
    occlusion,
    zoom: {
      slotSwitches: report.slotSwitches,
      finalDistance: camera.radius,
      idleBoxesStable: report.labels.every((label) => label.retained),
    },
    camera: {
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      radius: camera.radius,
      eye: camera.eye,
    },
  };
}

function isOrangePixel(data) {
  return data[3] > 24 && data[0] > 155 && data[1] < 155 && data[2] < 135;
}

function sampleOverlayLine(segment, inset = 0.08) {
  const context = measureCanvas.getContext("2d");
  const startX = segment.start.x + (segment.end.x - segment.start.x) * inset;
  const startY = segment.start.y + (segment.end.y - segment.start.y) * inset;
  const endX = segment.start.x + (segment.end.x - segment.start.x) * (1 - inset);
  const endY = segment.start.y + (segment.end.y - segment.start.y) * (1 - inset);
  const length = Math.hypot(endX - startX, endY - startY);
  const count = Math.max(8, Math.floor(length / 1.5));
  let orange = 0;
  let empty = 0;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = Math.round((startX + (endX - startX) * t) * state.dpr);
    const y = Math.round((startY + (endY - startY) * t) * state.dpr);
    const data = context.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
    let found = false;
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      if (isOrangePixel(data.slice(pixel, pixel + 4))) {
        found = true;
        break;
      }
    }
    if (found) orange += 1;
    else empty += 1;
  }
  return {
    samples: count + 1,
    orange,
    empty,
    coverage: orange / (count + 1),
  };
}

function pixelProof() {
  const result = {};
  for (const item of measurement.measurements) {
    const hidden = [...item.segments].sort((a, b) => b.lengthPx - a.lengthPx)[0];
    const visible = [...item.visibleSegments].sort((a, b) => b.lengthPx - a.lengthPx)[0];
    result[item.id] = {
      hidden: hidden ? sampleOverlayLine(hidden, 0.1) : null,
      visible: visible ? sampleOverlayLine(visible, 0.06) : null,
    };
  }
  return result;
}

window.__viewer = {
  ready: (async () => {
    resize();
    await waitForFrame(3);
    return true;
  })(),
  getState: snapshot,
  getMeasurements: () => measurement.measurements.map((item) => ({
    id: item.id,
    a: [...item.a],
    b: [...item.b],
    worldDistance: item.distance,
    hiddenRatio: item.hiddenRatio,
    hiddenSegments: item.segments.map((segment) => ({
      startT: segment.startT,
      endT: segment.endT,
      startPx: segment.startPx,
      endPx: segment.endPx,
      lengthPx: segment.lengthPx,
    })),
  })),
  async setCamera(next = {}) {
    if (Number.isFinite(next.azimuth)) {
      camera.azimuth = next.azimuth;
      state.targetAzimuth = next.azimuth;
    }
    if (Number.isFinite(next.elevation)) {
      camera.elevation = next.elevation;
      state.targetElevation = next.elevation;
    }
    if (Number.isFinite(next.radius)) {
      camera.radius = next.radius;
      state.targetRadius = next.radius;
    }
    await waitForFrame(2);
    return snapshot();
  },
  async zoomTo(radius, immediate = true) {
    state.targetRadius = clamp(radius, 12, 74);
    if (immediate) camera.radius = state.targetRadius;
    await waitForFrame(2);
    return snapshot();
  },
  async runZoomTrace(radii) {
    const frames = [];
    for (const requestedRadius of radii) {
      state.targetRadius = clamp(requestedRadius, 12, 74);
      let guard = 0;
      do {
        await waitForFrame(1);
        const report = state.lastReport;
        frames.push({
          requestedRadius,
          cameraRadius: camera.radius,
          zooming: state.zooming,
          labels: report.labels,
          slotSwitches: report.slotSwitches,
        });
        guard += 1;
      } while (Math.abs(camera.radius - state.targetRadius) > 0.03 && guard < 240);
    }
    return frames;
  },
  async waitForIdle(frames = 12) {
    await waitForFrame(frames);
    return snapshot();
  },
  projectPoint(point) {
    const viewProjection = currentViewProjection();
    return renderer.projectToSize(point, viewProjection, state.width, state.height);
  },
  sampleCanvas(x, y) {
    const context = measureCanvas.getContext("2d");
    return Array.from(context.getImageData(
      Math.round(x * state.dpr),
      Math.round(y * state.dpr),
      1,
      1,
    ).data);
  },
  getPixelProof: pixelProof,
};

resize();
requestAnimationFrame(frameLoop);

window.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") zoomBy(0.82);
  if (event.key === "-" || event.key === "_") zoomBy(1.22);
  if (event.key.toLowerCase() === "f") fitView();
});

root.dataset.viewerReady = "false";
window.__viewer.ready.then(() => {
  root.dataset.viewerReady = "true";
});
