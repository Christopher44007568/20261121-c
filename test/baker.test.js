import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakeMSDF, decodeByte } from '../src/baker.js';
import { insideAt, polygonArea, WINDING, vec } from '../src/geometry.js';
import { buildSegments, R, G, B } from '../src/color-mask.js';
import { parsePathData } from '../src/path-parser.js';
import { makeTransform, runDiff, tipClipping } from '../src/diff-harness.js';

// Square with a narrow vertical slot, 40 EM units wide.
function slottedShape() {
  const outer = [vec(-20, -20), vec(20, -20), vec(20, 20), vec(-20, 20)];
  // CW hole -> slot 2 EM wide, 24 tall.
  const hole = [vec(-1, -12), vec(-1, 12), vec(1, 12), vec(1, -12)];
  assert.ok(polygonArea(outer) > 0);
  assert.ok(polygonArea(hole) < 0);
  return { name: 'slot', contours: [{ points: outer }, { points: hole }] };
}

// Sharp upward spike ("needle") to test acute corners.
function spikeShape() {
  const pts = [vec(-12, -10), vec(12, -10), vec(0.6, 18), vec(0, 19), vec(-0.6, 18)];
  return { name: 'spike', contours: [{ points: pts }] };
}

// Two overlapping squares, same winding -> union under nonzero,
// intersection removed under even-odd.
function overlapShape() {
  const a = [vec(-14, -8), vec(4, -8), vec(4, 8), vec(-14, 8)];
  const b = [vec(-4, -8), vec(14, -8), vec(14, 8), vec(-4, 8)];
  return { name: 'overlap', contours: [{ points: a }, { points: b }] };
}

test('winding rules handle holes and overlaps', () => {
  const s = slottedShape();
  assert.equal(insideAt(vec(0, 0), s), false); // inside slot
  assert.equal(insideAt(vec(10, 0), s), true); // solid area
  const o = overlapShape();
  assert.equal(insideAt(vec(0, 0), o, WINDING.NONZERO), true);
  assert.equal(insideAt(vec(0, 0), o, WINDING.EVENODD), false);
  assert.equal(insideAt(vec(-9, 0), o, WINDING.EVENODD), true);
});

test('edge coloring uses two channels per edge and rotates at corners', () => {
  const s = slottedShape();
  const segs = buildSegments(s);
  const used = new Set();
  for (const seg of segs) {
    const count = (seg.mask & R ? 1 : 0) + (seg.mask & G ? 1 : 0) + (seg.mask & B ? 1 : 0);
    assert.equal(count, 2);
    used.add(seg.mask);
  }
  // All three two-channel pairs appear across the shape.
  assert.equal(used.size, 3);
  // Sharp-corner joins share exactly one channel somewhere on the hole.
  const slotEdges = buildSegments(s).filter((seg) => seg.contour === 1);
  let oneChannelJoins = 0;
  for (let i = 0; i < slotEdges.length; i++) {
    const shared = slotEdges[i].mask & slotEdges[(i + 1) % slotEdges.length].mask;
    const sharedCount = (shared & R ? 1 : 0) + (shared & G ? 1 : 0) + (shared & B ? 1 : 0);
    assert.ok(sharedCount >= 1);
    if (sharedCount === 1) oneChannelJoins++;
  }
  assert.ok(oneChannelJoins >= 1);
});

test('baked MSDF median keeps slot interior negative (inside = negative)', () => {
  const s = slottedShape();
  const bake = bakeMSDF(s, { size: 64, paddingEm: 4 });
  const half = bake.grid.span / 2;
  const emToPx = (p) => ({
    x: Math.floor((p.x - (bake.grid.cx - half)) / bake.emPerPx),
    y: Math.floor((bake.grid.cy + half - p.y) / bake.emPerPx),
  });
  const slotCenter = emToPx(vec(0, 0));
  const solid = emToPx(vec(10, 0));
  const sc = (slotCenter.y * 64 + slotCenter.x) * 4;
  const so = (solid.y * 64 + solid.x) * 4;
  const med = (idx) => {
    const r = decodeByte(bake.data[idx], bake.emPerPx, bake.distanceRangePx);
    const g = decodeByte(bake.data[idx + 1], bake.emPerPx, bake.distanceRangePx);
    const b = decodeByte(bake.data[idx + 2], bake.emPerPx, bake.distanceRangePx);
    return Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
  };
  assert.ok(med(sc) > 0, 'slot center must be outside (positive)');
  assert.ok(decodeByte(bake.data[sc + 3], bake.emPerPx, bake.distanceRangePx) > 0);
  assert.ok(med(so) < 0, 'solid area must be inside (negative)');
});

test('diff harness: SDF shows more hard errors than MSDF on the slot', () => {
  const s = slottedShape();
  const bake = bakeMSDF(s, { size: 48, paddingEm: 4, distanceRangePx: 4 });
  const transform = makeTransform({ scale: 26, skewX: 0.7, skewY: 0.15 });
  const result = runDiff(s, bake, transform, { width: 180, height: 180, superSamples: 3 });
  assert.ok(result.metrics.sdf.hardErrors >= result.metrics.msdf.hardErrors);
  assert.ok(result.metrics.sdf.maxAbs >= result.metrics.msdf.maxAbs);
});

test('spike glyph bakes without NaN and preserves tip sign', () => {
  const s = spikeShape();
  const bake = bakeMSDF(s, { size: 64, paddingEm: 4 });
  for (const v of bake.field) assert.ok(Number.isFinite(v));
  const half = bake.grid.span / 2;
  const tipPx = Math.floor((bake.grid.cy + half - 18.4) / bake.emPerPx);
  const midPx = Math.floor(64 / 2);
  const idx = (tipPx * 64 + midPx) * 4;
  const med = decodeByte(bake.data[idx], bake.emPerPx, 4);
  assert.ok(Number.isFinite(med));
});

test('SVG path with cubic curves and a hole parses into two contours', () => {
  const d =
    'M-10,-10 L10,-10 L10,10 L-10,10 Z M-2,-2 C-4,-4 4,-4 4,2 C4,6 -4,6 -4,2 Z';
  const shape = parsePathData(d, 0.02);
  assert.equal(shape.contours.length, 2);
  assert.ok(shape.contours[0].points.length >= 4);
  assert.ok(shape.contours[1].points.length > 4);
  const bake = bakeMSDF(shape, { size: 40 });
  assert.equal(bake.data.length, 40 * 40 * 4);
});

test('MSDF preserves an acute tip where monochrome SDF clips it', () => {
  // Spike whose tip reaches y=17 while its shoulders stay near y=16.
  const spike = parsePathData('M-10,-12 L10,-12 L0.3,16 L0,17 L-0.3,16 Z');
  const bake = bakeMSDF(spike, { size: 32, paddingEm: 3, distanceRangePx: 4 });
  const scale = 10;
  const viewport = 360;
  const originY = 20 + 18 * scale;
  const frontal = tipClipping(
    bake.oriented,
    bake,
    makeTransform({ scale }),
    viewport,
    originY
  );
  const oblique = tipClipping(
    bake.oriented,
    bake,
    makeTransform({ scale, skewX: 0.8, skewY: 0.25 }),
    viewport,
    originY
  );
  // SDF loses many tip pixels; MSDF stays within a couple of pixels.
  assert.ok(frontal.sdfClip >= 8);
  assert.ok(Math.abs(frontal.msdfClip) <= 3);
  assert.ok(oblique.sdfClip >= 8);
  assert.ok(Math.abs(oblique.msdfClip) <= 4);
  assert.ok(frontal.sdfClip > frontal.msdfClip);
});
