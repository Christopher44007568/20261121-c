// MSDF / SDF raster baker.
//
// Distance convention (msdfgen compatible): d < 0 INSIDE, d > 0 OUTSIDE.
//
// Two sign conventions coexist, mirroring msdfgen:
//   * Alpha (monochrome SDF) and the analytic ground truth use the GLOBAL
//     winding test, which supports nonzero and even-odd overlap rules.
//   * The three MSDF channels use edge-LOCAL signs (cross(aq, ab)): the left
//     side of a correctly oriented edge is negative. Each channel only
//     considers edges whose mask contains it, and the median of the three
//     pseudo-distances reconstructs the boundary. Local signs are what let
//     sharp corners and sub-texel narrow holes survive bilinear filtering.

import {
  insideAt,
  pointSegmentDistance2,
  perpendicularChannelDistance,
  WINDING,
} from './geometry.js';
import { buildSegments, R, G, B } from './color-mask.js';
import { normalizeContours } from './normalize.js';
import { correctChannels } from './error-correction.js';

export function shapeBounds(shape) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of shape.contours) {
    for (const p of c.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

// pixelToEm: texture pixel center -> EM coordinate.
export function makeGrid(shape, opts = {}) {
  const size = opts.size ?? 64;
  const paddingEm = opts.paddingEm ?? 2;
  const b = shapeBounds(shape);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const span = Math.max(w, h) + paddingEm * 2;
  const emPerPx = span / size;
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const half = span * 0.5;
  const pixelToEm = (px, py) => ({
    x: cx - half + (px + 0.5) * emPerPx,
    // Flip Y so texture row 0 is the top of the glyph.
    y: cy + half - (py + 0.5) * emPerPx,
  });
  return { size, emPerPx, pixelToEm, bounds: b, span, cx, cy };
}

export function encodeByte(d, emPerPx, distanceRangePx = 4) {
  const range = distanceRangePx * emPerPx;
  const norm = Math.max(-1, Math.min(1, d / range));
  return Math.round((norm * 0.5 + 0.5) * 255);
}

export function decodeByte(value, emPerPx, distanceRangePx = 4) {
  const range = distanceRangePx * emPerPx;
  return ((value / 255) * 2 - 1) * range;
}

function median3(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

// Bake the shape into an RGBA texture:
//   RGB = MSDF channels, A = monochrome SDF.
export function bakeMSDF(shape, opts = {}) {
  const oriented = normalizeContours(shape);
  const grid = makeGrid(oriented, opts);
  const { size, emPerPx, pixelToEm } = grid;
  const rangePx = opts.distanceRangePx ?? 4;
  const rule = opts.windingRule ?? WINDING.NONZERO;
  const segments = buildSegments(oriented, opts.cornerThreshold);
  // Fallback for a channel with no matching edge nearby. It must equal the
  // encoded range boundary so it maps to the extreme byte (outside), never a
  // mid-range value that the median could mistake for the interior.
  // True SDF fallback: far enough to never win against a real segment.
  const farSDF = rangePx * emPerPx * 16;
  // Selector fallback: effectively infinite so a real edge always wins.
  // Encoding clamps to the range boundary at byte conversion time.
  const farMSDF = rangePx * emPerPx * 1e4;

  const data = new Uint8ClampedArray(size * size * 4);
  const field = new Float32Array(size * size * 4); // raw per-channel distances for tests
  const median = new Float32Array(size * size); // reconstructed MSDF distance
  const insideGrid = new Uint8Array(size * size);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const p = pixelToEm(px, py);
      const inside = insideAt(p, oriented, rule);
      // Channels with no matching edge fall back to an extreme distance. Its
      // sign must match the global inside state so the median is not pulled
      // across the boundary; magnitude stays at the encodable range edge.
      const channelFallback = inside ? -farMSDF : farMSDF;
      let dMin = farSDF;
      for (const seg of segments) {
        const dist = Math.sqrt(pointSegmentDistance2(p, seg.a, seg.b));
        if (dist < dMin) dMin = dist;
      }
      const dR = perpendicularChannelDistance(p, segments, R, channelFallback);
      const dG = perpendicularChannelDistance(p, segments, G, channelFallback);
      const dB = perpendicularChannelDistance(p, segments, B, channelFallback);
      const sdf = inside ? -dMin : dMin;
      const msdf = median3(dR, dG, dB);

      const idx = py * size + px;
      insideGrid[idx] = inside ? 1 : 0;
      field[idx * 4] = dR;
      field[idx * 4 + 1] = dG;
      field[idx * 4 + 2] = dB;
      field[idx * 4 + 3] = sdf;
      median[idx] = msdf;
    }
  }

  const corrected = correctChannels(field, median, insideGrid, size);

  for (let idx = 0; idx < size * size; idx++) {
    const base = idx * 4;
    data[base] = encodeByte(field[base], emPerPx, rangePx);
    data[base + 1] = encodeByte(field[base + 1], emPerPx, rangePx);
    data[base + 2] = encodeByte(field[base + 2], emPerPx, rangePx);
    data[base + 3] = encodeByte(field[base + 3], emPerPx, rangePx);
  }

  return {
    data,
    field,
    median,
    size,
    emPerPx,
    distanceRangePx: rangePx,
    grid,
    segments,
    oriented,
    corrected,
  };
}
