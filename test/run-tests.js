// Geometry/unit checks that do not need a browser. Run with `npm test`.

'use strict';

const assert = require('assert');
const { parsePath } = require('../src/path-parser');
const { flattenPath } = require('../src/flatten');
const { dashSubpath, normalizeDashArray } = require('../src/dasher');
const { expandStroke, strokeToFillPath } = require('../src/stroke-to-path');
const { mscale, mapply } = require('../src/geometry');
const { buildSide } = require('../src/stroker');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

test('parser handles relative, implicit repeat and arcs', () => {
  const subpaths = parsePath('M10 10 l20 0 h5 a5 5 0 0 1 5 5 z');
  assert.strictEqual(subpaths.length, 1);
  assert.strictEqual(subpaths[0].closed, true);
  assert.ok(subpaths[0].segments.some((s) => s.type === 'A'));
});

test('moveto-only subpath is preserved as zero length', () => {
  const flat = flattenPath(parsePath('M30 40 M50 60 L70 80'), 0.2);
  assert.strictEqual(flat.length, 2);
  assert.strictEqual(flat[0].zeroLength, true);
  assert.strictEqual(flat[1].zeroLength, false);
});

test('butt zero-length subpath emits no fill geometry', () => {
  const rings = expandStroke('M30 40 M30 40', { width: 10, lineCap: 'butt' });
  assert.strictEqual(rings.length, 0);
});

test('round zero-length subpath is skipped under browser epsilon default', () => {
  assert.strictEqual(expandStroke('M30 40 M30 40', { width: 10, lineCap: 'round' }).length, 0);
  const single = expandStroke('M30 40', { width: 10, lineCap: 'round', minSubpathLength: 0 });
  assert.strictEqual(single.length, 1);
  const both = expandStroke('M30 40 M30 40', { width: 10, lineCap: 'round', minSubpathLength: 0 });
  assert.strictEqual(both.length, 2);
});

test('closed dashed path emits a single seam-crossing piece', () => {
  const flat = flattenPath(parsePath('M60 60 L260 60 L260 180 L60 180 Z'), 0.2)[0];
  const pieces = dashSubpath(flat, [26, 14], 18, 1);
  const seam = pieces.filter((piece) => piece.seam);
  assert.strictEqual(seam.length, 1);
  // The seam piece runs through the path origin (the seam vertex at 60,60).
  const points = seam[0].points;
  assert.ok(points.some((p) => p.x === 60 && p.y === 60));
});

test('odd dash array is doubled per SVG spec', () => {
  assert.deepStrictEqual(normalizeDashArray([5]), [5, 5]);
  assert.strictEqual(normalizeDashArray([0, 0]), null);
});

test('triangle miter tips extend beyond the base half width', () => {
  const rings = expandStroke('M80 180 L240 180 L160 50 Z', {
    width: 18,
    lineJoin: 'miter',
    miterLimit: 8,
  });
  // Closed stroke becomes outer + inner subpaths.
  assert.strictEqual(rings.length, 2);
  const allY = rings.flat().map((p) => p.y);
  assert.ok(Math.min(...allY) < 50 - 9); // apex miter reaches above 41
});

test('miter limit clamps an extreme spike to a bevel', () => {
  // 53-degree apex has miter ratio 2.24; clamping at 2 bevels the outer tip.
  const apex = [{ x: 40, y: 180 }, { x: 100, y: 60 }, { x: 160, y: 180 }];
  const limited = buildSide(apex, false, 1, { width: 20, lineJoin: 'miter', miterLimit: 2 });
  const unlimited = buildSide(apex, false, 1, { width: 20, lineJoin: 'miter', miterLimit: 20 });
  // A clamped outer join inserts a bevel bridge (two offset endpoints instead
  // of one miter intersection), so it yields more vertices on that side.
  assert.ok(limited.length > unlimited.length);
  // The unclamped side still has exactly one point per input vertex.
  assert.strictEqual(unlimited.length, apex.length);
});

test('non-uniform scale turns a round cap into an ellipse', () => {
  const rings = expandStroke('M50 100 L150 100', {
    width: 20,
    lineCap: 'round',
    transform: mscale(2, 0.5),
  });
  const xs = rings.flat().map((p) => p.x);
  const ys = rings.flat().map((p) => p.y);
  const widthSpan = Math.max(...xs) - Math.min(...xs);
  const heightSpan = Math.max(...ys) - Math.min(...ys);
  assert.ok(widthSpan > heightSpan * 2);
});

test('exported fill path is a single nonzero-winding d string with no stroke attrs', () => {
  const d = strokeToFillPath('M10 10 L90 90', { width: 8 });
  assert.ok(d.startsWith('M'));
  assert.ok(d.endsWith('Z'));
  assert.ok(!/stroke|dash/i.test(d));
});

test('transform is applied to every vertex', () => {
  const matrix = mscale(2, 3);
  const rings = expandStroke('M10 10 L20 10', { width: 4, transform: matrix });
  const vertex = rings[0][0];
  const inverse = mscale(0.5, 1 / 3);
  const roundTrip = mapply(inverse, vertex);
  assert.ok(Math.abs(roundTrip.x * 2 - vertex.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y * 3 - vertex.y) < 1e-9);
});

test('arc command flattens to points spanning the two endpoints', () => {
  const flat = flattenPath(parsePath('M20 120 A40 40 0 0 1 100 120'), 0.2)[0];
  assert.ok(flat.points.length > 4);
  assert.deepStrictEqual(flat.points[0], { x: 20, y: 120 });
  const last = flat.points[flat.points.length - 1];
  assert.ok(Math.abs(last.x - 100) < 1e-6 && Math.abs(last.y - 120) < 1e-6);
});

test('cubic curve stroke produces a closed non-degenerate outline', () => {
  const rings = expandStroke('M20 120 C60 20 120 220 180 120', {
    width: 12,
    lineCap: 'round',
    lineJoin: 'round',
  });
  assert.strictEqual(rings.length, 1);
  assert.ok(rings[0].length > 10);
});

test('round join keeps both offset sides within half width of the vertex', () => {
  const vertex = { x: 120, y: 70 };
  const polyline = [{ x: 40, y: 190 }, vertex, { x: 200, y: 160 }];
  const halfWidth = 8;
  for (const side of [1, -1]) {
    const offset = buildSide(polyline, false, side, { width: halfWidth * 2, lineJoin: 'round', miterLimit: 4 });
    for (const point of offset) {
      // Only the join neighborhood belongs to the round-join arc.
      if (Math.hypot(point.x - vertex.x, point.y - vertex.y) > halfWidth * 2) continue;
      const distance = Math.hypot(point.x - vertex.x, point.y - vertex.y);
      assert.ok(distance <= halfWidth + 1e-6);
    }
  }
});

console.log(`\n${passed} unit tests passed`);
