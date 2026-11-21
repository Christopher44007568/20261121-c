import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCamera } from '../src/camera.js';
import { anchor, scene, tourDuration, tourFrame } from '../src/data.js';
import {
  pickCPU,
  projectAbsoluteF32,
  projectForMode,
  projectReference,
} from '../src/precision.js';
import { roundStat, summarize } from '../src/stats.js';

const output = resolve('artifacts');
const width = 1440;
const height = 810;
const projection = { fovDegrees: 46, near: 0.01, far: 12000, width, height };
const stepSeconds = 0.18;
const cameras = [];
for (let time = 0; time < tourDuration; time += stepSeconds) {
  const frame = tourFrame(time);
  cameras.push({
    time,
    stop: frame.stop.id,
    camera: createCamera(frame.pose, projection, anchor),
  });
}

const rtcErrors = [];
const hiloErrors = [];
const absoluteErrors = [];
const relativeRtc = [];
const relativeHilo = [];
const bySite = {
  bund: { projection: { rtc: [], hilo: [], absolute: [] }, relative: { rtc: [], hilo: [] } },
  lujiazui: { projection: { rtc: [], hilo: [], absolute: [] }, relative: { rtc: [], hilo: [] } },
};
const csv = [
  'site_id,scenario,sample_index,marker_id,camera_east_m,camera_north_m,camera_up_m,' +
  'reference_x_px,reference_y_px,rtc_x_px,rtc_y_px,rtc_error_px,hilo_x_px,hilo_y_px,' +
  'hilo_error_px,absolute_f32_x_px,absolute_f32_y_px,absolute_f32_error_px,reference_visible',
];
const rtcPick = { samples: 0, matches: 0 };
const hiloPick = { samples: 0, matches: 0 };
const rtcClosePick = { samples: 0, matches: 0 };
const hiloClosePick = { samples: 0, matches: 0 };
const rtcCloseVisiblePick = { samples: 0, matches: 0 };
const hiloCloseVisiblePick = { samples: 0, matches: 0 };

function screenDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function csvNumber(value) {
  return Number.isFinite(value) ? value : 'NaN';
}

for (let sampleIndex = 0; sampleIndex < cameras.length; sampleIndex += 1) {
  const { camera, stop, time } = cameras[sampleIndex];
  const projected = scene.markers.map((marker) => ({
    marker,
    reference: projectReference(camera, marker.anchorEnu),
    rtc: projectForMode('rtc', camera, marker),
    hilo: projectForMode('hilo', camera, marker),
    absolute: projectAbsoluteF32(camera, marker.ecef),
  }));

  for (const item of projected) {
    const { marker, reference, rtc, hilo, absolute } = item;
    const site = bySite[marker.siteId];
    const rtcError = reference.visible && rtc.visible ? screenDistance(reference, rtc) : Infinity;
    const hiloError = reference.visible && hilo.visible ? screenDistance(reference, hilo) : Infinity;
    const absoluteError = reference.visible && Number.isFinite(absolute.x) && Number.isFinite(absolute.y)
      ? screenDistance(reference, absolute)
      : Infinity;
    if (Number.isFinite(rtcError)) {
      rtcErrors.push(rtcError);
      site.projection.rtc.push(rtcError);
    }
    if (Number.isFinite(hiloError)) {
      hiloErrors.push(hiloError);
      site.projection.hilo.push(hiloError);
    }
    if (Number.isFinite(absoluteError)) {
      absoluteErrors.push(absoluteError);
      site.projection.absolute.push(absoluteError);
    }

    if (reference.visible) {
      rtcPick.samples += 1;
      hiloPick.samples += 1;
      if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'rtc')?.marker.id === marker.id) {
        rtcPick.matches += 1;
      }
      if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'hilo')?.marker.id === marker.id) {
        hiloPick.matches += 1;
      }
      if (stop === 'bund' || stop === 'lujiazui') {
        rtcClosePick.samples += 1;
        hiloClosePick.samples += 1;
        if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'rtc')?.marker.id === marker.id) {
          rtcClosePick.matches += 1;
        }
        if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'hilo')?.marker.id === marker.id) {
          hiloClosePick.matches += 1;
        }
        const nearest = Math.min(...projected
          .filter((other) => other.marker.id !== marker.id && other.reference.visible)
          .map((other) => screenDistance(reference, other.reference)));
        if (nearest > 9.4) {
          rtcCloseVisiblePick.samples += 1;
          hiloCloseVisiblePick.samples += 1;
          if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'rtc')?.marker.id === marker.id) {
            rtcCloseVisiblePick.matches += 1;
          }
          if (pickCPU(camera, scene.markers, reference.x, reference.y, 4.7, 'hilo')?.marker.id === marker.id) {
            hiloCloseVisiblePick.matches += 1;
          }
        }
      }
    }

    const visible = reference.visible;
    csv.push([
      marker.siteId,
      stop,
      sampleIndex,
      marker.id,
      camera.eye[0].toFixed(9),
      camera.eye[1].toFixed(9),
      camera.eye[2].toFixed(9),
      csvNumber(reference.x),
      csvNumber(reference.y),
      csvNumber(rtc.x),
      csvNumber(rtc.y),
      csvNumber(rtcError),
      csvNumber(hilo.x),
      csvNumber(hilo.y),
      csvNumber(hiloError),
      csvNumber(absolute.x),
      csvNumber(absolute.y),
      csvNumber(absoluteError),
      visible,
    ].join(','));
  }

  const visibleItems = projected.filter((item) => item.reference.visible);
  for (let left = 0; left < visibleItems.length; left += 1) {
    for (let right = left + 1; right < visibleItems.length; right += 1) {
      if (visibleItems[left].marker.siteId !== visibleItems[right].marker.siteId) continue;
      const a = visibleItems[left];
      const b = visibleItems[right];
      if (!a.rtc.visible || !b.rtc.visible || !a.hilo.visible || !b.hilo.visible) continue;
      const referenceSpan = screenDistance(a.reference, b.reference);
      const rtcSpan = screenDistance(a.rtc, b.rtc);
      const hiloSpan = screenDistance(a.hilo, b.hilo);
      const rtcShift = Math.abs(rtcSpan - referenceSpan);
      const hiloShift = Math.abs(hiloSpan - referenceSpan);
      relativeRtc.push(rtcShift);
      relativeHilo.push(hiloShift);
      const site = bySite[a.marker.siteId];
      site.relative.rtc.push(rtcShift);
      site.relative.hilo.push(hiloShift);
    }
  }
}

function cleanSummary(summary) {
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => [
    key,
    typeof value === 'number' ? roundStat(value) : value,
  ]));
}

function siteReport(site) {
  return {
    projection: {
      samples: site.projection.rtc.length,
      rtc: cleanSummary(summarize(site.projection.rtc)),
      hilo: cleanSummary(summarize(site.projection.hilo)),
      absoluteF32: cleanSummary(summarize(site.projection.absolute)),
    },
    relativeMarkerStability: {
      samples: site.relative.rtc.length,
      rtc: cleanSummary(summarize(site.relative.rtc)),
      hilo: cleanSummary(summarize(site.relative.hilo)),
    },
  };
}

const distribution = {
  schema: 'terra-local/projection-error-distribution@2',
  generatedAt: new Date().toISOString(),
  reference: 'float64 CPU WGS84/ECEF/ENU projection',
  comparison: 'float32 eye-relative (RTC) and float32 high + residual low split submission',
  units: 'CSS pixels',
  width,
  height,
  poseCount: cameras.length,
  tourSeconds: tourDuration,
  sampleCount: rtcErrors.length,
  cameraRelative: cleanSummary(summarize(rtcErrors)),
  highLowSplit: cleanSummary(summarize(hiloErrors)),
  absoluteF32: cleanSummary(summarize(absoluteErrors)),
  relativeMarkerStability: {
    samples: relativeRtc.length,
    rtc: cleanSummary(summarize(relativeRtc)),
    hilo: cleanSummary(summarize(relativeHilo)),
  },
  picking: {
    note: 'cpuRayMatchRate is generated here; renderPathMatchRate is filled by scripts/capture.js from Chromium color-ID readback',
    referenceSamples: rtcPick.samples,
    rtc: {
      samples: rtcPick.samples,
      cpuRayMatches: rtcPick.matches,
      cpuRayMatchRate: rtcPick.samples ? rtcPick.matches / rtcPick.samples : 0,
      renderPathMatches: null,
      renderPathMatchRate: null,
    },
    hilo: {
      samples: hiloPick.samples,
      cpuRayMatches: hiloPick.matches,
      cpuRayMatchRate: hiloPick.samples ? hiloPick.matches / hiloPick.samples : 0,
      renderPathMatches: null,
      renderPathMatchRate: null,
    },
    closeOrbit: {
      note: 'markers are separated by 50 mm at close range; no billboard overlap is expected',
      rtc: {
        samples: rtcClosePick.samples,
        cpuRayMatches: rtcClosePick.matches,
        cpuRayMatchRate: rtcClosePick.samples ? rtcClosePick.matches / rtcClosePick.samples : 0,
      },
      hilo: {
        samples: hiloClosePick.samples,
        cpuRayMatches: hiloClosePick.matches,
        cpuRayMatchRate: hiloClosePick.samples ? hiloClosePick.matches / hiloClosePick.samples : 0,
      },
      unoccluded: {
        note: 'reference centers at least one billboard diameter from every other marker',
        rtc: {
          samples: rtcCloseVisiblePick.samples,
          cpuRayMatches: rtcCloseVisiblePick.matches,
          cpuRayMatchRate: rtcCloseVisiblePick.samples ? rtcCloseVisiblePick.matches / rtcCloseVisiblePick.samples : 0,
        },
        hilo: {
          samples: hiloCloseVisiblePick.samples,
          cpuRayMatches: hiloCloseVisiblePick.matches,
          cpuRayMatchRate: hiloCloseVisiblePick.samples ? hiloCloseVisiblePick.matches / hiloCloseVisiblePick.samples : 0,
        },
      },
    },
  },
  bySite: {
    bund: siteReport(bySite.bund),
    lujiazui: siteReport(bySite.lujiazui),
  },
};

await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'projection-error-distribution.json'), `${JSON.stringify(distribution, null, 2)}\n`);
await writeFile(resolve(output, 'projection-errors.csv'), `${csv.join('\n')}\n`);
console.log(`wrote ${csv.length - 1} projection samples across ${cameras.length} camera poses`);
console.log(`RTC p95=${distribution.cameraRelative.p95} px, HI/LO p95=${distribution.highLowSplit.p95} px`);
console.log(`ABS F32 p95=${distribution.absoluteF32.p95} px (collapse baseline)`);
