import {
  makeSkinEvaluator,
  normalizeSkinWeights,
  polarDecompose3,
  quatAngle,
  quatDot,
  quatFromAxisAngle,
  shortestNlerp,
} from "./skinning.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function bindPoseCase() {
  const positions = new Float32Array([0, 0, 0, 1, 0.5, 0, 0, 1, 0.5]);
  const joints = new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0]);
  const evaluator = makeSkinEvaluator({
    positions,
    joints,
    weights,
    inverseBindMatrices: [...identity, ...identity],
    ringStarts: [0],
    segments: 1,
  });
  const result = evaluator.evaluate([...identity, ...identity]);
  let maxError = 0;
  for (const channel of [result.lbs, result.dq]) {
    for (let index = 0; index < positions.length; index += 1) {
      maxError = Math.max(maxError, Math.abs(channel[index] - positions[index]));
    }
  }
  return {
    id: "bind",
    title: "绑定姿势恒等",
    subtitle: "BIND MATRICES → IDENTITY",
    value: `MAX ERROR ${maxError.toExponential(2)}`,
    pass: maxError < 1e-7,
    detail: `max |p′ − p| = ${maxError.toExponential(2)}；LBS 与 DQ 均通过。`,
  };
}

function negativeDotCase() {
  const start = quatFromAxisAngle([1, 0, 0], 0);
  const end = quatFromAxisAngle([1, 0, 0], (300 * Math.PI) / 180);
  const rawDot = quatDot(start, end);
  const rawMidpointAngle = (quatAngle(
    start.map((value, index) => value * 0.5 + end[index] * 0.5),
  ) * 180) /
    Math.PI;
  const corrected = shortestNlerp(start, end, 0.5);
  const correctedAngle = (quatAngle(corrected) * 180) / Math.PI;
  return {
    id: "dot",
    title: "负点积符号翻转",
    subtitle: "q0 · q1 < 0",
    value: `DOT ${rawDot.toFixed(6)} → SHORT ARC`,
    pass: rawDot < 0 && correctedAngle < rawMidpointAngle,
    detail: `dot(q0,q1) = ${rawDot.toFixed(6)}；未翻转中点 ${rawMidpointAngle.toFixed(1)}°，翻转后 ${correctedAngle.toFixed(1)}°。`,
  };
}

function normalizationCase() {
  const result = normalizeSkinWeights([0, 1, 2, 3], [0, 0.3, 0.9, 0]);
  const normalizedSum = result.weights.reduce((sum, value) => sum + value, 0);
  return {
    id: "normalize",
    title: "权重归一化",
    subtitle: "RAW Σ 1.200000",
    value: `Σw ${normalizedSum.toFixed(9)} · DROPPED ${result.dropped}`,
    pass: Math.abs(normalizedSum - 1) < 1e-12 && result.dropped === 2,
    detail: `[0, 0.3, 0.9, 0] → [0, 0.25, 0.75, 0]；Σw = ${normalizedSum.toFixed(12)}，移除 2 个零权重。`,
  };
}

function nonUniformScaleCase() {
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
  const multiply = (a, b) => [
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
  const matrix = multiply(rotation, scale);
  const decomposed = polarDecompose3(matrix);
  const reconstructed = multiply(decomposed.rotation, decomposed.symmetric);
  let maxError = 0;
  for (let index = 0; index < 9; index += 1) {
    maxError = Math.max(maxError, Math.abs(reconstructed[index] - matrix[index]));
  }
  return {
    id: "scale",
    title: "非均匀缩放分解",
    subtitle: "M = R · P",
    value: `RECON ERROR ${maxError.toExponential(2)}`,
    pass: maxError < 1e-7,
    detail: `S = diag(1, 1.5, 0.6)；极分解重建 max error = ${maxError.toExponential(2)}。`,
  };
}

export function runValidation() {
  return [bindPoseCase(), negativeDotCase(), normalizationCase(), nonUniformScaleCase()];
}
