import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContinuityEdges,
  continuityMetrics,
  polygonArea3D,
  ringArea,
} from "../src/metrics.js";

test("3D polygon area projects a planar square correctly", () => {
  const points = new Float32Array([
    -1, 0, -1,
    1, 0, -1,
    1, 0, 1,
    -1, 0, 1,
  ]);
  assert.ok(Math.abs(polygonArea3D(points) - 4) < 1e-10);
});

test("ring area uses the model-to-centimeter unit scale", () => {
  const positions = new Float32Array([
    0, -0.1, -0.1,
    0, 0.1, -0.1,
    0, 0.1, 0.1,
    0, -0.1, 0.1,
  ]);
  const area = ringArea(positions, 0, 4, 10);
  assert.ok(Math.abs(area - 4) < 1e-6);
});

test("continuity metrics report stretch from adjacent edge lengths", () => {
  const bind = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  const deformed = new Float32Array([0, 0, 0, 1.1, 0, 0, 0, 0.8, 0, 1.1, 0.8, 0]);
  const edges = buildContinuityEdges([0, 2], 2);
  const result = continuityMetrics(bind, deformed, edges);
  assert.ok(Math.abs(result.max - 0.2) < 1e-6);
  assert.ok(Math.abs(result.p95 - 0.2) < 1e-6);
  assert.equal(result.overFivePercent, 6);
});
