import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHomography,
  edgeFeather,
  fitHomography,
  invertMat3,
  matrixFromQuad,
  solveBlendLuminance,
  srgbToLinear,
} from "../js/geometry.js";

const quad = [
  [-24, -18],
  [690, 22],
  [675, 894],
  [-18, 918],
];

function gridPoints(columns = 6, rows = 4) {
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      points.push({
        x: col / (columns - 1),
        y: row / (rows - 1),
      });
    }
  }
  return points;
}

test("matrixFromQuad supports array corners and maps the unit square", () => {
  const matrix = matrixFromQuad(quad);
  const corners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  corners.forEach((point, index) => {
    const mapped = applyHomography(matrix, point);
    assert.ok(Math.abs(mapped.x - quad[index][0]) < 1e-7);
    assert.ok(Math.abs(mapped.y - quad[index][1]) < 1e-7);
  });
});

test("homography fit recovers an exact control grid", () => {
  const nominal = matrixFromQuad(quad);
  const source = gridPoints();
  const target = source.map((point) => applyHomography(nominal, point));
  const result = fitHomography(source, target);
  assert.ok(result.rms < 1e-8);
  assert.ok(result.max < 1e-7);
  target.slice(0, 5).forEach((point, index) => {
    const mapped = applyHomography(result.matrix, source[index]);
    assert.ok(Math.abs(mapped.x - point.x) < 1e-7);
    assert.ok(Math.abs(mapped.y - point.y) < 1e-7);
  });
});

test("homography inverse round-trips screen coordinates", () => {
  const matrix = matrixFromQuad(quad);
  const inverse = invertMat3(matrix);
  const screen = { x: 412.3, y: 287.8 };
  const uv = applyHomography(inverse, screen);
  const restored = applyHomography(matrix, uv);
  assert.ok(Math.abs(restored.x - screen.x) < 1e-8);
  assert.ok(Math.abs(restored.y - screen.y) < 1e-8);
});

test("a non-planar control point produces a positive least-squares residual", () => {
  const nominal = matrixFromQuad(quad);
  const source = gridPoints();
  const target = source.map((point) => applyHomography(nominal, point));
  target[9] = { x: target[9].x + 36, y: target[9].y + 14 };
  const result = fitHomography(source, target);
  assert.ok(Number.isFinite(result.rms));
  assert.ok(result.rms > 1);
  assert.ok(result.max > 20);
});

test("edge feather reaches one at center and zero on the borders", () => {
  assert.equal(edgeFeather(0, 0.14), 0);
  assert.equal(edgeFeather(1, 0.14), 0);
  assert.equal(edgeFeather(0.5, 0.14), 1);
  assert.ok(edgeFeather(0.07, 0.14) > 0 && edgeFeather(0.07, 0.14) < 1);
});

test("linear-light blend preserves a uniform gray with matched gains", () => {
  const nominal = matrixFromQuad(quad);
  const target = srgbToLinear(0.5);
  const channels = [
    { enabled: true, gain: 1, inverse: invertMat3(nominal), feather: 0.14 },
    { enabled: true, gain: 1, inverse: invertMat3(nominal), feather: 0.14 },
  ];
  const result = solveBlendLuminance(channels, { x: 300, y: 420 }, target);
  assert.ok(result.covered);
  assert.ok(Math.abs(result.luminance - target) < 1e-12);
  channels[1].gain = 1.12;
  const mismatched = solveBlendLuminance(channels, { x: 300, y: 420 }, target);
  assert.ok(mismatched.luminance > target * 1.03);
});
