// 2D visualization of baked textures and the raster differential results.

import { makeTransform, runDiff, buildHeatmap } from '../src/diff-harness.js';

function paint(canvas, width, height, fill) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  img.data.set(fill);
  ctx.putImageData(img, 0, 0);
}

export function paintTexturePreview(canvas, bake, mode) {
  const size = bake.size;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const src = i * 4;
    if (mode === 'msdf') {
      out[src] = bake.data[src];
      out[src + 1] = bake.data[src + 1];
      out[src + 2] = bake.data[src + 2];
    } else {
      const v = bake.data[src + 3];
      out[src] = v;
      out[src + 1] = v;
      out[src + 2] = v;
    }
    out[src + 3] = 255;
  }
  paint(canvas, size, size, out);
}

export function paintEdgeColorPreview(canvas, bake) {
  const size = bake.size;
  const out = new Uint8ClampedArray(size * size * 4);
  const mid = (px, py, ch) => bake.data[(py * size + px) * 4 + ch];
  // Show which channel pair dominates at each texel (diagnostic overlay).
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      out[i] = mid(px, py, 0);
      out[i + 1] = mid(px, py, 1);
      out[i + 2] = mid(px, py, 2);
      out[i + 3] = 255;
    }
  }
  paint(canvas, size, size, out);
}

function coverageToRgba(cov, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(cov[i] * 255);
    out[i * 4] = 30 + v;
    out[i * 4 + 1] = 34 + v;
    out[i * 4 + 2] = 44 + v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Run one diff case and paint GT / MSDF / SDF / heatmap into four canvases.
export function renderDiffCase(shape, bake, opts, canvases, windingRule) {
  const referenceShape = bake.oriented ?? shape;
  const transform = makeTransform({
    scale: opts.scale,
    skewX: opts.skewX,
    skewY: opts.skewY,
  });
  const result = runDiff(referenceShape, bake, transform, {
    width: opts.viewport,
    height: opts.viewport,
    superSamples: 3,
    windingRule,
  });
  const { width, height } = result;
  paint(canvases.gt, width, height, coverageToRgba(result.gt, width, height));
  paint(canvases.msdf, width, height, coverageToRgba(result.msCov, width, height));
  paint(canvases.sdf, width, height, coverageToRgba(result.sdfCov, width, height));
  paint(canvases.heat, width, height, buildHeatmap(result, 'hard'));
  return result;
}

// Sweep zoom levels to show when narrow features collapse in single-channel SDF.
export function sweepScales(shape, bake, scales, windingRule, skew = 0) {
  const referenceShape = bake.oriented ?? shape;
  return scales.map((scale) => {
    const result = runDiff(referenceShape, bake, makeTransform({ scale, skewX: skew }), {
      width: 160,
      height: 160,
      superSamples: 2,
      windingRule,
    });
    return {
      scale,
      msdfErrors: result.metrics.msdf.hardErrors,
      sdfErrors: result.metrics.sdf.hardErrors,
      sdfFilledHole: result.metrics.sdf.filledHole,
      sdfClipped: result.metrics.sdf.clippedSolid,
      msdfFilledHole: result.metrics.msdf.filledHole,
      msdfClipped: result.metrics.msdf.clippedSolid,
    };
  });
}
