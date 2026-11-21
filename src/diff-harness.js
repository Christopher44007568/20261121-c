// Raster differential harness.
//
// Renders the baked texture the same way a GPU sampler would (bilinear,
// screen-space threshold) under an affine transform (zoom + oblique shear),
// compares it against an analytic winding ground truth, and reports where
// monochrome SDF deviates from MSDF: acute corner clipping and narrow-hole
// collapse are the headline failures.

import { insideAt, WINDING } from './geometry.js';
import { decodeByte } from './baker.js';

// Affine map: em point -> screen px.
export function makeTransform({ scale = 40, skewX = 0, skewY = 0, tx = 0, ty = 0 } = {}) {
  return {
    a: scale,
    b: skewX * scale,
    c: skewY * scale,
    d: scale,
    e: tx,
    f: ty,
    apply(em) {
      return {
        x: this.a * em.x + this.b * em.y + this.e,
        y: this.c * em.x + this.d * em.y + this.f,
      };
    },
    invert(sx, sy) {
      const det = this.a * this.d - this.b * this.c;
      const x = sx - this.e;
      const y = sy - this.f;
      return {
        x: (this.d * x - this.b * y) / det,
        y: (this.a * y - this.c * x) / det,
      };
    },
  };
}

function bilinear(data, size, tx, ty, channel) {
  const cx = Math.max(0, Math.min(size - 1.001, tx));
  const cy = Math.max(0, Math.min(size - 1.001, ty));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const v = (x, y) => data[(y * size + x) * 4 + channel];
  const top = v(x0, y0) * (1 - fx) + v(x1, y0) * fx;
  const bot = v(x0, y1) * (1 - fx) + v(x1, y1) * fx;
  return top * (1 - fy) + bot * fy;
}

function median(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

// Sample the stored texture at an EM point, returning decoded distances (EM).
export function sampleTexture(bake, emPoint, mode) {
  const { size, emPerPx, grid } = bake;
  const half = grid.span * 0.5;
  const tx = (emPoint.x - (grid.cx - half)) / emPerPx - 0.5;
  const ty = ((grid.cy + half) - emPoint.y) / emPerPx - 0.5;
  if (tx < -1 || ty < -1 || tx > size || ty > size) return null;
  const sample = (channel) =>
    decodeByte(bilinear(bake.data, size, tx, ty, channel), emPerPx, bake.distanceRangePx);
  if (mode === 'sdf') {
    return sample(3);
  }
  return median(sample(0), sample(1), sample(2));
}

// Screen-space coverage: positive distance => inside after threshold.
function coverage(distanceEm, transform, emPerPx, rangePx) {
  // Mirror the WebGL shader exactly. The shader works in texture-texel
  // distance units: d_tex = distanceEm / emPerPx, then alpha = 0.5 - d/w
  // where w is the screen-space derivative of d. Under an oblique transform
  // the projected texel footprint widens, so fwidth grows and the edge
  // transition broadens to roughly one physical pixel.
  const dTex = distanceEm / emPerPx;
  // fwidth of the texel-space distance. The texture coordinate changes
  // anisotropically under skew; |dFdx| and |dFdy| are measured separately and
  // summed, matching the GPU's fwidth intrinsic.
  const w = Math.max(1e-5, fwidthTexDistance(transform, emPerPx));
  return Math.max(0, Math.min(1, 0.5 - dTex / w));
}

// fwidth of the texel-space signed distance: how much the distance changes
// between adjacent screen pixels along x and y, summed. We invert the affine
// map to obtain d(texelCoord)/d(screenPx), then take its vector magnitude per
// axis. A larger value means a wider (softer) edge at grazing angles.
export function fwidthTexDistance(transform, emPerPx) {
  const det = transform.a * transform.d - transform.b * transform.c;
  // Jacobian of screen -> EM, then EM -> texture texels.
  const invA = transform.d / det / emPerPx;
  const invB = -transform.b / det / emPerPx;
  const invC = -transform.c / det / emPerPx;
  const invD = transform.a / det / emPerPx;
  const gradX = Math.hypot(invA, invC);
  const gradY = Math.hypot(invB, invD);
  return gradX + gradY;
}

// Supersampled analytic ground truth coverage.
function groundTruthCoverage(shape, rule, transform, sx, sy, samples = 4) {
  let hits = 0;
  const k = samples;
  for (let iy = 0; iy < k; iy++) {
    for (let ix = 0; ix < k; ix++) {
      const em = transform.invert(sx + (ix + 0.5) / k, sy + (iy + 0.5) / k);
      if (insideAt(em, shape, rule)) hits++;
    }
  }
  return hits / (k * k);
}

// Run the full raster comparison inside a screen-space viewport.
// viewport: {width, height, originX, originY} centers the EM origin at origin.
export function runDiff(shape, bake, transform, options = {}) {
  const width = options.width ?? 220;
  const height = options.height ?? 220;
  const originX = options.originX ?? width / 2;
  const originY = options.originY ?? height / 2;
  const rule = options.windingRule ?? WINDING.NONZERO;
  const threshold = options.coverageThreshold ?? 0.5;

  const gt = new Float32Array(width * height);
  const msCov = new Float32Array(width * height);
  const sdfCov = new Float32Array(width * height);
  const metrics = {
    pixels: width * height,
    gtInside: 0,
    msdf: { hardErrors: 0, totalAbs: 0, maxAbs: 0, filledHole: 0, clippedSolid: 0 },
    sdf: { hardErrors: 0, totalAbs: 0, maxAbs: 0, filledHole: 0, clippedSolid: 0 },
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sx = x - originX;
      const sy = originY - y;
      const g = groundTruthCoverage(shape, rule, transform, sx, sy, options.superSamples ?? 4);
      gt[idx] = g;
      const em = transform.invert(sx + 0.5, sy + 0.5);
      const dMs = sampleTexture(bake, em, 'msdf');
      const dSdf = sampleTexture(bake, em, 'sdf');
      const cMs = dMs == null ? 0 : coverage(dMs, transform, bake.emPerPx, bake.distanceRangePx);
      const cSdf = dSdf == null ? 0 : coverage(dSdf, transform, bake.emPerPx, bake.distanceRangePx);
      msCov[idx] = cMs;
      sdfCov[idx] = cSdf;

      const gtHard = g >= threshold;
      if (gtHard) metrics.gtInside++;
      accumulate(metrics.msdf, cMs, gtHard, threshold, g);
      accumulate(metrics.sdf, cSdf, gtHard, threshold, g);
    }
  }
  normalize(metrics.msdf, metrics.pixels);
  normalize(metrics.sdf, metrics.pixels);

  const boundary = boundaryAccuracy(shape, bake, transform);

  return { width, height, gt, msCov, sdfCov, metrics, boundary };
}

function accumulate(m, cov, gtHard, threshold, gtCov) {
  const hard = cov >= threshold;
  const absErr = Math.abs(cov - gtCov);
  m.totalAbs += absErr;
  m.maxAbs = Math.max(m.maxAbs, absErr);
  if (hard !== gtHard) {
    m.hardErrors++;
    if (hard && !gtHard) m.filledHole++;
    else m.clippedSolid++;
  }
}

function normalize(m, pixels) {
  m.meanAbs = m.totalAbs / pixels;
  delete m.totalAbs;
  m.hardErrorRate = m.hardErrors / pixels;
}

// Build a diagnostic RGBA heatmap.
// mode 'hard'  : red = filled where GT empty, blue = clipped where GT inside.
// mode 'error' : yellow intensity = |coverage - GT|.
export function buildHeatmap(result, mode = 'hard') {
  const { width, height, gt, msCov, sdfCov } = result;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const g = gt[i] >= 0.5;
    const sHard = sdfCov[i] >= 0.5;
    const mHard = msCov[i] >= 0.5;
    let r = 0;
    let gr = 0;
    let b = 0;
    if (mode === 'hard') {
      if (sHard && !g) r = 230; // SDF fills a hole
      else if (!sHard && g) b = 230; // SDF clips solid area
      if (mHard !== g) gr = 120; // MSDF disagreement (should be rare)
    } else {
      const e = Math.abs(sdfCov[i] - gt[i]);
      r = Math.min(255, e * 255 * 2);
      gr = Math.min(255, e * 255 * 2);
    }
    out[i * 4] = r;
    out[i * 4 + 1] = gr;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = r || gr || b ? 220 : 0;
  }
  return out;
}

// Boundary placement accuracy: sample each field directly ON the analytic
// outline (t-midpoints of every baked segment) and measure how far the
// reconstructed signed distance is from zero, expressed in screen pixels.
// This isolates the true MSDF advantage (sharp-corner / narrow-feature
// fidelity) from coverage-threshold noise caused by anti-aliasing width.
export function boundaryAccuracy(shape, bake, transform) {
  const screenPxPerEm = Math.hypot(transform.a, transform.c);
  let sumM = 0;
  let sumS = 0;
  let maxM = 0;
  let maxS = 0;
  let count = 0;
  for (const seg of bake.segments) {
    const steps = Math.max(2, Math.round(
      Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) / bake.emPerPx
    ));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const em = {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
      };
      const dMs = sampleTexture(bake, em, 'msdf');
      const dSdf = sampleTexture(bake, em, 'sdf');
      if (dMs == null || dSdf == null) continue;
      const eMs = Math.abs(dMs) * screenPxPerEm;
      const eSdf = Math.abs(dSdf) * screenPxPerEm;
      sumM += eMs * eMs;
      sumS += eSdf * eSdf;
      maxM = Math.max(maxM, eMs);
      maxS = Math.max(maxS, eSdf);
      count++;
    }
  }
  return {
    samples: count,
    msdfRms: Math.sqrt(sumM / count),
    sdfRms: Math.sqrt(sumS / count),
    msdfMax: maxM,
    sdfMax: maxS,
  };
}

// Tip clipping measurement: the smallest screen row where each field still
// reports inside. A larger row offset versus the ground-truth tip means the
// rendered point is blunter. Monochrome SDF rounds acute tips; MSDF's median
// keeps them sharp. Returns screen-pixel clipping for MSDF and SDF.
export function tipClipping(shape, bake, transform, viewport, originY) {
  const result = runDiff(shape, bake, transform, {
    width: viewport,
    height: viewport,
    superSamples: 2,
    originX: viewport / 2,
    originY,
  });
  let topGT = viewport;
  let topMSDF = viewport;
  let topSDF = viewport;
  for (let y = 0; y < viewport; y++) {
    for (let x = 0; x < viewport; x++) {
      const i = y * viewport + x;
      if (result.gt[i] >= 0.5) topGT = Math.min(topGT, y);
      if (result.msCov[i] >= 0.5) topMSDF = Math.min(topMSDF, y);
      if (result.sdfCov[i] >= 0.5) topSDF = Math.min(topSDF, y);
    }
  }
  return { msdfClip: topMSDF - topGT, sdfClip: topSDF - topGT };
}
