import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATE,
  boardBounds,
  createCamera,
  measureContactEdge,
  measurePenumbra,
  measureSlice,
  rayBoxSegment,
  vec,
  visibilityAt
} from "../src/scene.js";

test("camera basis is orthonormal and looks at its target", () => {
  const camera = createCamera({ yaw: 0.4, pitch: 0.25, distance: 8, aspect: 1.5 });
  assert.ok(Math.abs(vec.dot(camera.forward, camera.right)) < 1e-6);
  assert.ok(Math.abs(vec.dot(camera.forward, camera.up)) < 1e-6);
  assert.ok(Math.abs(vec.dot(camera.right, camera.up)) < 1e-6);
  assert.ok(Math.abs(vec.length(camera.forward) - 1) < 1e-6);
  const towardTarget = vec.normalize(vec.sub(camera.target, camera.position));
  assert.ok(vec.dot(camera.forward, towardTarget) > 0.999999);
});

test("the occluder blocks a floor-to-light segment inside its shadow", () => {
  const state = { ...DEFAULT_STATE, boardGap: 0.2, boardOffset: 0.15 };
  const bounds = boardBounds(state);
  const origin = [0, 0.001, state.boardOffset + 0.35];
  const light = [0, 4.65, -1.2];
  assert.equal(rayBoxSegment(origin, vec.sub(light, origin), bounds), true);

  const outside = [5, 0.001, state.boardOffset + 0.35];
  assert.equal(rayBoxSegment(outside, vec.sub(light, outside), bounds), false);
});

test("visibility is dark in the core and lit outside the shadow", () => {
  const state = { ...DEFAULT_STATE, boardGap: 0.3, boardOffset: 0.2 };
  const core = visibilityAt(0, state.boardOffset + 0.65, state, 96);
  const outside = visibilityAt(-4.8, state.boardOffset + 0.65, state, 96);
  assert.ok(core < 0.12, `expected dark core, got ${core}`);
  assert.ok(outside > 0.75, `expected lit exterior, got ${outside}`);
});

test("penumbra widens across the five receiver-depth probes", () => {
  const probes = measurePenumbra(DEFAULT_STATE, { areaSamples: 64, slices: 72 });
  const widths = probes.map((probe) => probe.width);
  assert.ok(widths.every(Number.isFinite));
  for (let index = 1; index < widths.length; index += 1) {
    assert.ok(widths[index] > widths[index - 1], `probe ${index} did not widen`);
  }
});

test("a wider rectangular light produces a wider side-edge penumbra", () => {
  const narrow = measureSlice({ ...DEFAULT_STATE, lightWidth: 0.5 }, 0.66, 72, 64);
  const wide = measureSlice({ ...DEFAULT_STATE, lightWidth: 4.0 }, 0.66, 72, 64);
  assert.ok(Number.isFinite(narrow.width));
  assert.ok(Number.isFinite(wide.width));
  assert.ok(wide.width > narrow.width * 1.35);
});

test("the contact edge softens as the board moves away from the receiver", () => {
  const near = measureContactEdge({ ...DEFAULT_STATE, boardGap: 0.04 }, { areaSamples: 64, slices: 72 });
  const far = measureContactEdge({ ...DEFAULT_STATE, boardGap: 1.0 }, { areaSamples: 64, slices: 72 });
  assert.ok(Number.isFinite(near.width));
  assert.ok(Number.isFinite(far.width));
  assert.ok(far.width > near.width * 3);
});
