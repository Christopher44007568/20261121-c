import assert from "node:assert/strict";
import test from "node:test";
import {
  GAPS,
  MASK,
  OBSTACLE,
  frameRateTracerDrift,
  integrateStreamline,
  maskCode,
  runAnalyticChecks,
} from "../src/flow.js";

test("uniform drift crosses the open east boundary", () => {
  const path = integrateStreamline({ x: -0.65, y: -0.3 }, 0, 4, 1 / 480);
  assert.equal(path.exited, true);
  assert.ok(path.x > 0.75);
  assert.equal(path.masked, false);
});

test("vortex rotates counter-clockwise and converges inward", () => {
  const checks = runAnalyticChecks(1.2);
  assert.equal(checks.rotation.pass, true);
  assert.ok(checks.rotation.circulation > 0);
  assert.equal(checks.convergence.pass, true);
  assert.ok(checks.convergence.flux < 0);
});

test("obstacle, missing regions and exterior have distinct mask codes", () => {
  assert.equal(maskCode(OBSTACLE.x, OBSTACLE.y), MASK.OBSTACLE);
  assert.equal(maskCode(GAPS[0].x, GAPS[0].y), MASK.MISSING);
  assert.equal(maskCode(GAPS[1].x, GAPS[1].y), MASK.MISSING);
  assert.equal(maskCode(-0.12, 0.18), MASK.VALID);
  assert.equal(maskCode(0.79, 0.12), MASK.OUTSIDE);
});

test("identical physical duration has cadence-dependent transport drift", () => {
  const drift = frameRateTracerDrift(2, 30, 120);
  assert.equal(drift.duration, 2);
  assert.ok(drift.rms > 0);
  assert.ok(drift.max >= drift.rms);
  assert.ok(Number.isFinite(drift.max));
});
