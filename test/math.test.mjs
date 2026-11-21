import test from "node:test";
import assert from "node:assert/strict";
import {
  perspectiveReverseZ,
  lookAt,
  multiply,
  invert,
  transformPoint,
  reverseZRawToDistance
} from "../src/math.js";
import { buildMaxPyramid, downsampleMax } from "../src/depth-pyramid.js";

const near = 0.08;
const far = 62;

function projectedViewZ(z) {
  const projection = perspectiveReverseZ(new Float32Array(16), 1.0, 1.5, near, far);
  return transformPoint(projection, [0, 0, z]);
}

test("reverse-Z maps the near plane to 1 and the far plane to 0", () => {
  const nearClip = projectedViewZ(-near);
  const farClip = projectedViewZ(-far);
  assert.ok(Math.abs(nearClip[2] * 0.5 + 0.5 - 1) < 1e-6);
  assert.ok(Math.abs(farClip[2] * 0.5 + 0.5) < 1e-6);
});

test("near depths retain more reverse-Z precision than far depths", () => {
  const nearA = projectedViewZ(-0.5)[2] * 0.5 + 0.5;
  const nearB = projectedViewZ(-0.51)[2] * 0.5 + 0.5;
  const farA = projectedViewZ(-40)[2] * 0.5 + 0.5;
  const farB = projectedViewZ(-40.01)[2] * 0.5 + 0.5;
  assert.ok(Math.abs(nearA - nearB) > Math.abs(farA - farB));
});

test("reverse-Z depth linearization round-trips", () => {
  const distance = 3.2;
  const projection = perspectiveReverseZ(new Float32Array(16), 1.0, 1.5, near, far);
  const clip = transformPoint(projection, [0, 0, -distance]);
  const raw = clip[2] * 0.5 + 0.5;
  assert.ok(Math.abs(reverseZRawToDistance(raw, near, far) - distance) < 1e-5);
  assert.ok(Math.abs(reverseZRawToDistance(1, near, far) - near) < 1e-9);
  assert.ok(Math.abs(reverseZRawToDistance(0, near, far) - far) < 1e-6);
});

test("view-projection inversion reconstructs a world point", () => {
  const view = lookAt(new Float32Array(16), [1.2, 1.3, 2.3], [-0.1, 0.6, 0], [0, 1, 0]);
  const projection = perspectiveReverseZ(new Float32Array(16), 0.9, 1.5, near, far);
  const viewProjection = multiply(new Float32Array(16), projection, view);
  const inverse = invert(new Float32Array(16), viewProjection);
  const point = [-0.2, 0.15, -0.4];
  const clip = transformPoint(viewProjection, point);
  const rebuilt = transformPoint(inverse, [clip[0], clip[1], clip[2]]);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(rebuilt[i] - point[i]) < 1e-5);
  }
});

test("max-depth pyramid keeps the nearest reverse-Z sample", () => {
  const source = new Float32Array([
    0.02, 0.10, 0.04, 0.06,
    0.08, 0.03, 0.07, 0.05,
    0.01, 0.09, 0.06, 0.05,
    0.04, 0.02, 0.08, 0.07
  ]);
  const level = downsampleMax(source, 4, 4);
  [0.10, 0.07, 0.09, 0.08].forEach((value, index) => {
    assert.ok(Math.abs(level.data[index] - value) < 1e-6);
  });
  const chain = buildMaxPyramid(source, 4, 4, 3);
  assert.ok(Math.abs(chain[2].data[0] - 0.10) < 1e-6);
});
