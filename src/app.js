import { createCamera, projectPoint } from './camera.js';
import {
  anchor,
  overviewPose,
  scene,
  sitePose,
  sites,
  siteSeparationMeters,
  tourFrame,
  tourStops,
} from './data.js';
import { clamp, cross, dot, normalize, scale, sub } from './geo.js';
import { PrecisionOverlay } from './overlay.js';
import { pickCPU } from './precision.js';
import { Renderer } from './renderer.js';
import {
  buildLabels,
  buildProgress,
  renderErrorPanel,
  showToast,
  updateLabels,
  updatePickReadout,
  updateProgress,
  updateTelemetry,
} from './ui.js';

const canvas = document.getElementById('scene');
const overlayCanvas = document.getElementById('precision-overlay');
const renderer = new Renderer(canvas, scene);
const overlay = new PrecisionOverlay(overlayCanvas);
const labels = buildLabels(scene);
const projection = {
  fovDegrees: 46,
  near: 0.01,
  far: 12000,
  width: window.innerWidth,
  height: window.innerHeight,
};

let mode = 'rtc';
let diagnostics = false;
let playing = true;
let tourTime = 0;
let manualPose = null;
let lastPose = null;
let camera = null;
let selectedId = null;
let lastFrameTime = performance.now();
let hoverMarker = null;
let dragging = false;
let dragDistance = 0;
let pointerStart = null;
let lastHoverCheck = 0;
let lastFrame = null;

buildProgress(tourStops);

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  projection.width = width;
  projection.height = height;
  renderer.resize(width, height, pixelRatio);
  overlay.resize(width, height, pixelRatio);
}

function currentPose() {
  if (playing) {
    return tourFrame(tourTime).pose;
  }
  return manualPose || tourFrame(tourTime).pose;
}

function makeCamera() {
  return createCamera(currentPose(), projection, anchor);
}

function updateHeader(frame) {
  const site = frame.stop.siteIndex === undefined ? null : sites[frame.stop.siteIndex];
  if (playing) {
    document.getElementById('status-main').textContent = frame.stop.label;
    document.getElementById('status-sub').textContent =
      `AUTO CRUISE · ${site ? `${site.shortName} CLOSE ORBIT · ` : ''}CAMERA TANGENT TO WGS84 ELLIPSOID`;
  } else {
    document.getElementById('status-main').textContent =
      site ? `${site.shortName} / MANUAL ORBIT` : 'OVERVIEW / MANUAL ORBIT';
    document.getElementById('status-sub').textContent =
      'DRAG TO ORBIT · WHEEL TO SCALE · CLICK A MARKER TO PICK';
  }
  document.getElementById('subtitle').textContent = site
    ? `${mode === 'hilo' ? 'HI/LO RESIDUAL' : 'RTC EYE-RELATIVE'} FLOAT32 · ${site.shortName} CLOSE ORBIT · FOV 46`
    : 'TWO SITES 940 M APART ON A SHARED WGS84 ENU ANCHOR';
  document.getElementById('mode-badge').textContent =
    `${mode === 'hilo' ? 'HI/LO' : 'RTC'} · FLOAT32`;
  document.getElementById('tour-button').textContent = playing ? '❚❚ PAUSE' : '▶ CRUISE';
  document.getElementById('mode-button').textContent =
    mode === 'rtc' ? 'USE HI/LO' : 'USE RTC';
  document.getElementById('diag-button').classList.toggle('active', diagnostics);
  document.querySelectorAll('.site-link').forEach((button) => {
    const id = button.dataset.site;
    button.classList.toggle(
      'active',
      (id === 'overview' && !site) || (site && id === site.id),
    );
  });
  updateProgress(frame);
}

function frame(now) {
  const delta = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (playing) {
    tourTime = (tourTime + delta) % tourStops.at(-1).end;
    lastFrame = tourFrame(tourTime);
  } else if (!lastFrame) {
    lastFrame = tourFrame(tourTime);
  }
  const pose = currentPose();
  lastPose = pose;
  camera = createCamera(pose, projection, anchor);
  renderer.setMode(mode);
  renderer.render(camera);
  overlay.draw(camera, scene, diagnostics);
  updateLabels(labels, camera, scene, selectedId);
  updateHeader(lastFrame || tourFrame(tourTime));
  updateTelemetry(camera, scene, mode, siteSeparationMeters);
  requestAnimationFrame(frame);
}

function pause() {
  if (!playing) return;
  playing = false;
  manualPose = lastPose;
}

function play() {
  playing = true;
  manualPose = null;
  document.getElementById('tour-button').textContent = '❚❚ PAUSE';
}

function jumpToStop(stopId) {
  const stop = tourStops.find((item) => item.id === stopId);
  if (!stop) return;
  tourTime = stop.start + Math.min(1.2, stop.duration * 0.2);
  playing = true;
  manualPose = null;
  lastFrame = tourFrame(tourTime);
}

function getTangentAxes(up) {
  let east = sub(anchor.basis.east, scale(up, dot(anchor.basis.east, up)));
  if (Math.hypot(...east) < 1e-6) east = sub(anchor.basis.north, scale(up, dot(anchor.basis.north, up)));
  east = normalize(east);
  const north = normalize(cross(up, east));
  return { east, north };
}

function orbit(dx, dy) {
  if (!manualPose) pause();
  const pose = manualPose;
  const up = normalize(pose.up);
  const { east, north } = getTangentAxes(up);
  const offset = sub(pose.eye, pose.target);
  const radius = Math.hypot(...offset);
  if (radius < 1e-8) return;
  let yaw = Math.atan2(dot(offset, north), dot(offset, east));
  let pitch = Math.asin(clamp(dot(offset, up) / radius, -1, 1));
  yaw -= dx * 0.006;
  pitch = clamp(pitch + dy * 0.0045, -1.35, 1.48);
  const horizontal = Math.cos(pitch) * radius;
  manualPose = {
    eye: [
      pose.target[0] + east[0] * Math.cos(yaw) * horizontal + north[0] * Math.sin(yaw) * horizontal + up[0] * Math.sin(pitch) * radius,
      pose.target[1] + east[1] * Math.cos(yaw) * horizontal + north[1] * Math.sin(yaw) * horizontal + up[1] * Math.sin(pitch) * radius,
      pose.target[2] + east[2] * Math.cos(yaw) * horizontal + north[2] * Math.sin(yaw) * horizontal + up[2] * Math.sin(pitch) * radius,
    ],
    target: pose.target,
    up,
  };
}

function zoom(deltaY) {
  if (!manualPose) pause();
  const pose = manualPose;
  const offset = sub(pose.eye, pose.target);
  const radius = Math.hypot(...offset);
  const next = clamp(radius * Math.exp(deltaY * 0.0012), 0.045, 7000);
  manualPose = {
    eye: [
      pose.target[0] + (offset[0] / radius) * next,
      pose.target[1] + (offset[1] / radius) * next,
      pose.target[2] + (offset[2] / radius) * next,
    ],
    target: pose.target,
    up: pose.up,
  };
}

function pickAt(x, y) {
  if (!camera) return null;
  const gpu = renderer.pickGPU(camera, x, y);
  const ray = pickCPU(camera, scene.markers, x, y, 4.7, mode);
  const rayMarker = ray ? ray.marker : null;
  const match = (gpu?.id || null) === (rayMarker?.id || null);
  const chosen = gpu || rayMarker;
  selectedId = chosen ? chosen.id : null;
  renderer.setSelection(selectedId);
  const gpuLabel = gpu ? gpu.id : 'NONE';
  const rayLabel = rayMarker ? rayMarker.id : 'NONE';
  updatePickReadout(`GPU ${gpuLabel} · RAY ${rayLabel}\nMATCH ${match ? 'YES' : 'NO'}`);
  if (chosen) {
    const marker = scene.markerById[chosen.id];
    showToast(`PICKED ${marker.id} · ${marker.offsetCm[0]}, ${marker.offsetCm[1]} CM · MATCH ${match ? 'YES' : 'NO'}`);
  } else {
    showToast('NO MARKER · SAMPLE EMPTY');
  }
  return { gpu, ray: rayMarker, match, selected: chosen };
}

function selectMarker(id) {
  selectedId = id;
  renderer.setSelection(id);
  if (id) {
    const marker = scene.markerById[id];
    updatePickReadout(`SELECTED ${marker.id}\nOFFSET ${marker.offsetCm[0]}, ${marker.offsetCm[1]} CM`);
  }
}

async function runSelfTest() {
  if (!camera) return null;
  const previousMode = mode;
  const previousSelection = selectedId;
  renderer.setSelection(null);
  const results = {};
  for (const testMode of ['rtc', 'hilo']) {
    renderer.setMode(testMode);
    const misses = [];
    let samples = 0;
    for (const marker of scene.markers) {
      const ref = projectPoint(camera, marker.anchorEnu);
      if (!ref.visible) continue;
      samples += 1;
      const gpu = renderer.pickGPU(camera, ref.x, ref.y);
      const ray = pickCPU(camera, scene.markers, ref.x, ref.y, 4.7, testMode);
      const rayId = ray ? ray.marker.id : null;
      if (gpu?.id !== marker.id || rayId !== marker.id) {
        misses.push({ expected: marker.id, gpu: gpu?.id ?? null, ray: rayId });
      }
    }
    results[testMode] = {
      samples,
      matches: samples - misses.length,
      matchRate: samples ? (samples - misses.length) / samples : 0,
      misses,
    };
  }
  mode = previousMode;
  renderer.setMode(mode);
  renderer.setSelection(previousSelection);
  const text = `SELF-TEST · RTC ${results.rtc.matches}/${results.rtc.samples} · HI/LO ${results.hilo.matches}/${results.hilo.samples}`;
  showToast(text, 3200);
  updatePickReadout(text.replace('SELF-TEST · ', 'PICK SELF-TEST\n'));
  return results;
}

function setMode(nextMode) {
  mode = nextMode === 'hilo' ? 'hilo' : 'rtc';
  renderer.setMode(mode);
  document.getElementById('mode-badge').textContent =
    `${mode === 'hilo' ? 'HI/LO' : 'RTC'} · FLOAT32`;
}

function setDiagnostics(enabled) {
  diagnostics = Boolean(enabled);
  document.body.classList.toggle('diagnostics', diagnostics);
  document.getElementById('error-panel').hidden = !diagnostics;
  document.getElementById('diag-button').classList.toggle('active', diagnostics);
}

function jumpToSite(siteId, angle = 0.62) {
  playing = false;
  manualPose = null;
  selectedId = null;
  renderer.setSelection(null);
  hoverMarker = null;
  document.getElementById('cursor-label').hidden = true;
  document.getElementById('toast').classList.remove('show');
  canvas.style.cursor = 'crosshair';
  updatePickReadout('NO SAMPLE');
  if (siteId === 'overview') {
    manualPose = overviewPose();
    tourTime = tourStops[0].start + 0.8;
  } else {
    const site = scene.siteById[siteId];
    if (!site) return;
    manualPose = sitePose(site, angle);
    const stop = tourStops.find((item) => item.id === siteId);
    tourTime = stop ? stop.start + 1.2 : tourTime;
  }
  lastFrame = tourFrame(tourTime);
  lastFrame = { ...lastFrame, stop: tourStops.find((item) => item.id === siteId) || lastFrame.stop };
}

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playing ? pause() : play();
  } else if (event.key === '1') jumpToSite('bund');
  else if (event.key === '2') jumpToSite('lujiazui');
  else if (event.key === '0') jumpToSite('overview');
  else if (event.key.toLowerCase() === 'd') setDiagnostics(!diagnostics);
  else if (event.key.toLowerCase() === 'm') setMode(mode === 'rtc' ? 'hilo' : 'rtc');
  else if (event.key === 'Escape') selectMarker(null);
});

document.querySelector('.controls').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'tour') {
    playing ? pause() : play();
  } else if (action === 'mode') {
    setMode(mode === 'rtc' ? 'hilo' : 'rtc');
  } else if (action === 'diagnostics') {
    setDiagnostics(!diagnostics);
  } else if (action === 'selftest') {
    runSelfTest();
  }
});

document.querySelector('.site-rail').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) jumpToSite(button.dataset.site);
});

let pointerLast = null;
canvas.addEventListener('pointerdown', (event) => {
  pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  pointerLast = { x: event.clientX, y: event.clientY };
  dragging = false;
  dragDistance = 0;
  canvas.setPointerCapture(event.pointerId);
  if (playing) pause();
});

canvas.addEventListener('pointermove', (event) => {
  if (pointerStart && event.buttons) {
    const dx = event.clientX - pointerLast.x;
    const dy = event.clientY - pointerLast.y;
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > 3) dragging = true;
    if (dragging) orbit(dx, dy);
    pointerLast = { x: event.clientX, y: event.clientY };
    document.getElementById('cursor-label').hidden = true;
    return;
  }
  if (!camera) return;
  const now = performance.now();
  if (now - lastHoverCheck < 55) return;
  lastHoverCheck = now;
  const hit = pickCPU(camera, scene.markers, event.clientX, event.clientY, 4.7, mode);
  hoverMarker = hit ? hit.marker : null;
  canvas.style.cursor = hoverMarker ? 'pointer' : 'crosshair';
  const label = document.getElementById('cursor-label');
  if (hoverMarker) {
    label.hidden = false;
    label.textContent = `${hoverMarker.id} · ${hoverMarker.offsetCm[0]}, ${hoverMarker.offsetCm[1]} CM`;
    label.style.left = `${event.clientX + 15}px`;
    label.style.top = `${event.clientY + 11}px`;
  } else {
    label.hidden = true;
  }
});

canvas.addEventListener('pointerup', (event) => {
  if (!pointerStart) return;
  const elapsed = performance.now() - pointerStart.time;
  const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (!dragging && movement < 5 && elapsed < 650) {
    pickAt(event.clientX, event.clientY);
  }
  pointerStart = null;
  pointerLast = null;
  dragging = false;
});

canvas.addEventListener('pointercancel', () => {
  pointerStart = null;
  pointerLast = null;
  dragging = false;
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (playing) pause();
  zoom(event.deltaY);
}, { passive: false });

window.addEventListener('resize', resize);

let distribution = null;
fetch('./artifacts/projection-error-distribution.json', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => {
    if (!data) return;
    distribution = data;
    renderErrorPanel(data);
  })
  .catch(() => null);

resize();
tourTime = 0.25;
lastFrame = tourFrame(tourTime);
document.getElementById('clock').textContent =
  `LAT ${anchor.geodetic.latitude.toFixed(5)} N · LON ${anchor.geodetic.longitude.toFixed(5)} E`;

window.__TERRA__ = {
  ready: false,
  scene,
  getState: () => ({
    mode,
    diagnostics,
    playing,
    tourTime,
    selectedId,
    siteSeparationMeters,
    camera: camera ? {
      eye: camera.eye,
      eyeEcef: camera.eyeEcef,
      target: camera.target,
      width: camera.width,
      height: camera.height,
      range: Math.hypot(
        camera.eye[0] - camera.target[0],
        camera.eye[1] - camera.target[1],
        camera.eye[2] - camera.target[2],
      ),
    } : null,
    distribution,
  }),
  setMode,
  setDiagnostics,
  pause,
  play,
  setTourTime: (time) => {
    tourTime = time;
    playing = false;
    manualPose = null;
    lastFrame = tourFrame(tourTime);
  },
  jumpToSite,
  selectMarker,
  pickAt,
  runSelfTest,
  projectMarker: (id) => {
    const marker = scene.markerById[id];
    return camera && marker ? projectPoint(camera, marker.anchorEnu) : null;
  },
  screenForMarker: (id) => {
    const marker = scene.markerById[id];
    if (!camera || !marker) return null;
    const hit = projectPoint(camera, marker.anchorEnu);
    return hit.visible ? { x: hit.x, y: hit.y, depth: hit.depth } : null;
  },
};

requestAnimationFrame((now) => {
  lastFrameTime = now;
  frame(now);
  window.__TERRA__.ready = true;
  document.getElementById('loading').classList.add('hidden');
});
