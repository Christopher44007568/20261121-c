import test from "node:test";
import assert from "node:assert/strict";
import {
  dqFromRigid,
  makeSkinEvaluator,
  normalizeSkinWeights,
  quatAngle,
  quatDot,
  quatFromAxisAngle,
  polarDecompose3,
  shortestNlerp,
} from "../src/skinning.js";

const close = (actual, expected, epsilon = 1e-8) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const columnMajor = (linear, translation = [0, 0, 0]) => [
  linear[0],
  linear[3],
  linear[6],
  0,
  linear[1],
  linear[4],
  linear[7],
  0,
  linear[2],
  linear[5],
  linear[8],
  0,
  ...translation,
  1,
];

const multiply3 = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

test("bind pose evaluates to identity in LBS and DQ", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0.5, 0, 0, 1, 0.5]);
  const joints = new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0]);
  const identity = columnMajor([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const evaluator = makeSkinEvaluator({
    positions,
    joints,
    weights,
    inverseBindMatrices: [...identity, ...identity],
    ringStarts: [0],
    segments: 1,
  });
  const result = evaluator.evaluate([...identity, ...identity]);
  for (let index = 0; index < positions.length; index += 1) {
    close(result.lbs[index], positions[index]);
    close(result.dq[index], positions[index]);
  }
});

test("negative quaternion dot is corrected to the short arc", () => {
  const start = quatFromAxisAngle([1, 0, 0], 0);
  const end = quatFromAxisAngle([1, 0, 0], (300 * Math.PI) / 180);
  close(quatDot(start, end), -0.8660254037844386, 1e-12);
  const midpoint = shortestNlerp(start, end, 0.5);
  close((quatAngle(midpoint) * 180) / Math.PI, 30, 1e-10);

  const dual = dqFromRigid(start, [0, 0, 0]);
  const dualEnd = dqFromRigid(end, [0, 0, 0]);
  assert.ok(quatDot(dual.real, dualEnd.real) < 0);
});

test("skin weights are normalized after zero influences are removed", () => {
  const result = normalizeSkinWeights([0, 1, 2, 3], [0, 0.3, 0.9, 0]);
  assert.equal(result.fallback, false);
  assert.equal(result.dropped, 2);
  assert.deepEqual(result.joints, [1, 2]);
  close(result.weights[0], 0.25, 1e-12);
  close(result.weights[1], 0.75, 1e-12);
  close(result.weights.reduce((sum, value) => sum + value, 0), 1, 1e-12);
});

test("zero-weight vertex falls back to joint zero with unit weight", () => {
  const result = normalizeSkinWeights([2, 3, 1, 0], [0, 0, 0, 0]);
  assert.equal(result.fallback, true);
  assert.deepEqual(result.joints.slice(0, 1), [0]);
  close(result.weights[0], 1, 1e-12);
});

test("polar decomposition reconstructs rotation and non-uniform scale", () => {
  const angle = (32 * Math.PI) / 180;
  const rotation = [
    Math.cos(angle),
    -Math.sin(angle),
    0,
    Math.sin(angle),
    Math.cos(angle),
    0,
    0,
    0,
    1,
  ];
  const scale = [1, 0, 0, 0, 1.5, 0, 0, 0, 0.6];
  const matrix = multiply3(rotation, scale);
  const result = polarDecompose3(matrix);
  const reconstructed = multiply3(result.rotation, result.symmetric);
  for (let index = 0; index < 9; index += 1) {
    close(reconstructed[index], matrix[index], 1e-7);
  }
  close(result.symmetric[4], 1.5, 1e-7);
  close(result.symmetric[8], 0.6, 1e-7);
});

test("DQ scale compensation matches LBS for a single scaled bone", () => {
  const positions = new Float32Array([0.2, 0.6, -0.4]);
  const joints = new Uint16Array([0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0]);
  const identity = columnMajor([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const scaled = columnMajor([1, 0, 0, 0, 1.4, 0, 0, 0, 0.7]);
  const evaluator = makeSkinEvaluator({
    positions,
    joints,
    weights,
    inverseBindMatrices: identity,
    ringStarts: [0],
    segments: 1,
  });
  const result = evaluator.evaluate(scaled);
  for (let index = 0; index < 3; index += 1) {
    close(result.dq[index], result.lbs[index], 1e-7);
  }
  close(result.dq[1], 0.84, 1e-7);
  close(result.dq[2], -0.28, 1e-7);
});
