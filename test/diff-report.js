// Pixel-level differential comparison against browser reference PNGs.
//
// Two metrics are reported per scene:
//   mismatchPixels  - pixels with an alpha delta above `alphaThreshold`
//   meanAlphaDelta  - average absolute alpha difference over all pixels
//   maxBandPx       - greatest symmetric one-sided boundary displacement,
//                     measured as the distance between coverage edge bands.
// Tolerances separate expected rasterizer/anti-aliasing noise from geometry
// errors: see TOLERANCE below.

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { cases } = require('./cases');

const RENDER_DIR = path.join(__dirname, '..', 'artifacts', 'render');
const ALPHA_THRESHOLD = 32; // 0..255; ignores faint AA shimmer
const TOLERANCE = {
  mismatchRatio: 0.006, // <= 0.6% of all pixels
  meanAlphaDelta: 2.0,
  maxBandPx: 1.6,
};

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

// Coverage value 0..255: transparent/white background is 0, dark ink is 255.
function coverageAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 0;
  const offset = (y * png.width + x) * 4;
  const r = png.data[offset];
  const g = png.data[offset + 1];
  const b = png.data[offset + 2];
  const alpha = png.data[offset + 3] / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Math.round((1 - luminance) * alpha * 255);
}

function compare(referencePng, candidatePng) {
  const width = referencePng.width;
  const height = referencePng.height;
  let mismatchPixels = 0;
  let alphaDeltaSum = 0;
  const refEdge = [];
  const candEdge = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const refAlpha = coverageAt(referencePng, x, y);
      const candAlpha = coverageAt(candidatePng, x, y);
      const delta = Math.abs(refAlpha - candAlpha);
      alphaDeltaSum += delta;
      if (delta > ALPHA_THRESHOLD) mismatchPixels += 1;
      if (refAlpha > 128) refEdge.push([x, y]);
      if (candAlpha > 128) candEdge.push([x, y]);
    }
  }

  // Boundary band distance: for each edge pixel unique to one side, find the
  // nearest edge pixel of the other side. Bounded scan keeps this cheap.
  const refSet = new Set(refEdge.map(([x, y]) => y * width + x));
  const candSet = new Set(candEdge.map(([x, y]) => y * width + x));
  let maxBandPx = 0;
  const radius = 6;

  function nearestOther(x, y, ownSet, otherSet) {
    if (otherSet.has(y * width + x)) return 0;
    for (let r = 1; r <= radius; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (otherSet.has(ny * width + nx)) return r;
        }
      }
    }
    return radius + 1;
  }

  for (const [x, y] of refEdge) {
    if (!candSet.has(y * width + x)) {
      maxBandPx = Math.max(maxBandPx, nearestOther(x, y, refSet, candSet));
    }
  }
  for (const [x, y] of candEdge) {
    if (!refSet.has(y * width + x)) {
      maxBandPx = Math.max(maxBandPx, nearestOther(x, y, candSet, refSet));
    }
  }

  return {
    mismatchPixels,
    mismatchRatio: mismatchPixels / (width * height),
    meanAlphaDelta: alphaDeltaSum / (width * height),
    maxBandPx,
    refCoverage: refEdge.length,
    candCoverage: candEdge.length,
  };
}

function sceneIds() {
  const ids = [];
  for (const scene of cases) {
    if (scene.variants) {
      for (const variant of scene.variants) ids.push(`${scene.id}-${variant.lineCap}`);
    } else {
      ids.push(scene.id);
    }
  }
  return ids;
}

function run() {
  const rows = [];
  let allPassed = true;
  for (const id of sceneIds()) {
    const referencePng = readPng(path.join(RENDER_DIR, `${id}-reference.png`));
    const candidatePng = readPng(path.join(RENDER_DIR, `${id}-candidate.png`));
    const metrics = compare(referencePng, candidatePng);
    const passed = metrics.mismatchRatio <= TOLERANCE.mismatchRatio
      && metrics.meanAlphaDelta <= TOLERANCE.meanAlphaDelta
      && metrics.maxBandPx <= TOLERANCE.maxBandPx;
    allPassed = allPassed && passed;
    rows.push({ id, passed, ...metrics });
  }

  const lines = [];
  lines.push('scene                          pass  mismatch  ratio     meanΔα   bandPx  coverage ref/cand');
  for (const row of rows) {
    lines.push(
      `${row.id.padEnd(30)} ${row.passed ? 'PASS' : 'FAIL'}  `
      + `${String(row.mismatchPixels).padStart(6)}  `
      + `${row.mismatchRatio.toFixed(4).padStart(7)}  `
      + `${row.meanAlphaDelta.toFixed(3).padStart(6)}  `
      + `${String(row.maxBandPx).padStart(5)}  `
      + `${row.refCoverage}/${row.candCoverage}`,
    );
  }
  const report = lines.join('\n');
  fs.mkdirSync(path.dirname(path.join(RENDER_DIR, 'diff-report.txt')), { recursive: true });
  fs.writeFileSync(path.join(RENDER_DIR, 'diff-report.txt'), `${report}\n`);
  console.log(report);
  console.log(`\ntolerance: ratio<=${TOLERANCE.mismatchRatio}, meanΔα<=${TOLERANCE.meanAlphaDelta}, band<=${TOLERANCE.maxBandPx}px`);
  if (!allPassed) process.exitCode = 1;
  return rows;
}

if (require.main === module) run();
module.exports = { compare, TOLERANCE };
