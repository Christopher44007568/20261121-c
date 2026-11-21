import { projectPoint } from './camera.js';

const $ = (id) => document.getElementById(id);

export function formatMeters(value, digits = 3) {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function formatError(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (value < 0.0001) return value.toExponential(2);
  return value.toFixed(5);
}

export function buildProgress(stops) {
  const target = $('tour-progress');
  target.textContent = '';
  const total = stops.at(-1).end;
  for (const stop of stops) {
    const bar = document.createElement('i');
    bar.style.flexGrow = String(stop.duration);
    bar.dataset.stop = stop.id;
    bar.title = `${stop.label} · ${stop.duration.toFixed(1)}s`;
    bar.style.width = `${(stop.duration / total) * 100}%`;
    target.append(bar);
  }
}

export function updateProgress(frame) {
  const bars = [...document.querySelectorAll('#tour-progress i')];
  const activeIndex = bars.findIndex((bar) => bar.dataset.stop === frame.stop.id);
  bars.forEach((bar, index) => {
    bar.classList.toggle('done', index < activeIndex);
    if (index === activeIndex) {
      bar.style.setProperty('--fill', `${frame.progress * 100}%`);
    }
  });
}

export function buildLabels(scene) {
  const layer = $('labels');
  layer.textContent = '';
  const siteElements = new Map();
  const markerElements = new Map();
  for (const site of scene.sites) {
    const element = document.createElement('div');
    element.className = 'site-label';
    element.textContent = site.shortName;
    layer.append(element);
    siteElements.set(site.id, element);
  }
  const anchorElement = document.createElement('div');
  anchorElement.className = 'site-label anchor-label';
  anchorElement.textContent = 'ANCHOR / TANGENT ORIGIN';
  layer.append(anchorElement);
  for (const marker of scene.markers) {
    const element = document.createElement('div');
    element.className = 'marker-label';
    element.hidden = true;
    layer.append(element);
    markerElements.set(marker.id, element);
  }
  return { siteElements, markerElements, anchorElement };
}

export function updateLabels(layers, camera, scene, selectedId) {
  const cameraRange = Math.hypot(
    camera.eye[0] - camera.target[0],
    camera.eye[1] - camera.target[1],
    camera.eye[2] - camera.target[2],
  );
  for (const site of scene.sites) {
    const element = layers.siteElements.get(site.id);
    const hit = projectPoint(camera, site.anchorEnu);
    const show = hit.visible && cameraRange > 120;
    element.hidden = !show;
    if (show) {
      element.style.transform = `translate(${hit.x}px, ${hit.y}px) translate(10px, -8px)`;
    }
  }
  const anchorHit = projectPoint(camera, [0, 0, 0.18]);
  layers.anchorElement.hidden = cameraRange < 120 || !anchorHit.visible;
  if (!layers.anchorElement.hidden) {
    layers.anchorElement.style.transform =
      `translate(${anchorHit.x}px, ${anchorHit.y}px) translate(10px, -8px)`;
  }
  for (const marker of scene.markers) {
    const element = layers.markerElements.get(marker.id);
    const hit = projectPoint(camera, marker.anchorEnu);
    const show = marker.id === selectedId && hit.visible;
    element.hidden = !show;
    if (show) {
      element.textContent = `${marker.id} / ${marker.offsetCm[0] >= 0 ? '+' : ''}${marker.offsetCm[0]}, ${marker.offsetCm[1] >= 0 ? '+' : ''}${marker.offsetCm[1]} cm`;
      element.style.transform = `translate(${hit.x}px, ${hit.y}px) translate(10px, -8px)`;
    }
  }
}

export function updateTelemetry(camera, scene, mode, siteSeparation) {
  $('anchor-x').textContent = formatMeters(scene.anchor.ecef[0]);
  $('anchor-y').textContent = formatMeters(scene.anchor.ecef[1]);
  $('anchor-z').textContent = formatMeters(scene.anchor.ecef[2]);
  $('camera-x').textContent = formatMeters(camera.eyeEcef[0]);
  $('camera-y').textContent = formatMeters(camera.eyeEcef[1]);
  $('camera-z').textContent = formatMeters(camera.eyeEcef[2]);
  const range = Math.hypot(
    camera.eye[0] - camera.target[0],
    camera.eye[1] - camera.target[1],
    camera.eye[2] - camera.target[2],
  );
  $('range').textContent = range < 10
    ? `${(range * 100).toFixed(2)} cm`
    : `${range.toFixed(1)} m`;
  $('site-sep').textContent = `${siteSeparation.toFixed(2)} m`;
  $('vertex-path').textContent = mode === 'hilo' ? 'F32 HI + RESIDUAL' : 'F64 → F32 ONCE';
}

let toastTimer = null;
export function showToast(message, duration = 1800) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

export function updatePickReadout(text) {
  $('pick-readout').textContent = text;
}

export function renderErrorPanel(distribution) {
  if (!distribution) return;
  $('rtc-p95').textContent = formatError(distribution.cameraRelative.p95);
  $('hilo-p95').textContent = formatError(distribution.highLowSplit.p95);
  $('abs-p95').textContent = distribution.absoluteF32
    ? formatError(distribution.absoluteF32.p95)
    : 'COLLAPSE';
  $('error-units').textContent = `CSS PX / ${distribution.width}×${distribution.height}`;
  const pickRate = distribution.picking.rtc.renderPathMatchRate ??
    distribution.picking.closeOrbit?.rtc?.cpuRayMatchRate;
  $('error-note').textContent =
    `${distribution.sampleCount} SAMPLES · RTC MAX ${formatError(distribution.cameraRelative.max)} PX` +
    ` · PICK ${Number.isFinite(pickRate) ? `${(pickRate * 100).toFixed(0)}%` : '—'}`;
  const histogram = $('histogram');
  histogram.textContent = '';
  const bins = distribution.cameraRelative.histogram;
  const counts = bins.map((bin) => bin.count);
  const maximum = Math.max(1, ...counts);
  bins.forEach((bin, index) => {
    const bar = document.createElement('i');
    const ratio = Math.log10(1 + bin.count) / Math.log10(1 + maximum);
    bar.style.height = `${Math.max(1, ratio * 100)}%`;
    bar.title = `${bin.lowerPixels}–${bin.upperPixels ?? '∞'} px: ${bin.count}`;
    histogram.append(bar);
  });
  if (distribution.absoluteF32) {
    const bar = document.createElement('i');
    bar.className = 'abs';
    bar.style.height = '100%';
    bar.title = `absolute ECEF float32 p95: ${distribution.absoluteF32.p95} px`;
    histogram.append(bar);
  }
}
