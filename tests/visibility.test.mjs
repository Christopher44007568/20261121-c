import test from "node:test";
import assert from "node:assert/strict";

import { buildScene, CAMERA_STATIONS, VIEW_CONFIG } from "../src/scene.js";
import { createAnalyzer } from "../src/visibility.js";
import {
  depthQuantization,
  offsetFailureDistance,
  quantizeDepth
} from "../src/math.js";

const solid = buildScene();
const analyzer = createAnalyzer(solid, VIEW_CONFIG);
const settings = { offset: 0.05, tolerance: 1e-9, aspect: 16 / 9 };

function analyzeStation(id, override = {}) {
  const pose = CAMERA_STATIONS.find((station) => station.id === id);
  return analyzer.analyze(pose, { ...settings, ...override });
}

test("scene contains thin-sheet back edges, coplanar lines and far gates", () => {
  const thinBack = solid.edges.filter((edge) => edge.thinBack);
  const coplanar = solid.edges.filter((edge) => edge.kind === "coplanar");
  const gates = new Set(
    solid.edges
      .map((edge) => edge.metadata.gateDistance)
      .filter((distance) => Number.isFinite(distance))
  );
  assert.equal(thinBack.length, 4);
  assert.ok(coplanar.length >= 16);
  assert.deepEqual([...gates].sort((a, b) => a - b), [120, 320, 760, 1600, 3200]);
});

test("thin-sheet view exposes offset back-edge leakage but not depth leakage", () => {
  const result = analyzeStation("fin");
  assert.ok(result.thinBackHidden > 0);
  assert.ok(result.offsetThinLeak > 0);
  assert.equal(result.depthThinLeak, 0);
});

test("projection offset passes coplanar lines near the camera", () => {
  const result = analyzeStation("overview");
  assert.ok(result.coplanarTotal > 0);
  assert.equal(result.offsetCoplanarRate, 1);
  assert.equal(result.depthCoplanarRate, 1);
});

test("edges occluded by another part are rejected by depth compatibility", () => {
  for (const id of ["overview", "fin", "occluded"]) {
    const result = analyzeStation(id);
    assert.ok(result.externalHidden > 0, `${id} should contain externally hidden samples`);
    assert.equal(result.depthExternalLeak, 0, `${id} leaked externally hidden edges`);
  }
});

test("far field kills offset edges at a finite distance but keeps depth-compatible edges", () => {
  const result = analyzeStation("far");
  assert.ok(result.offsetFarInView);
  assert.ok(Number.isFinite(result.offsetFar));
  assert.ok(result.offsetFar <= 3200);
  assert.ok(result.offsetMissed > 0);
  assert.equal(result.depthMissed, 0);
  assert.equal(result.depthFar, Infinity);
});

test("offset failure distance is below the far-field gate span", () => {
  const failure = offsetFailureDistance(
    settings.offset,
    VIEW_CONFIG.near,
    VIEW_CONFIG.far,
    VIEW_CONFIG.depthBits
  );
  assert.ok(failure > 100 && failure < 3200);
  assert.ok(failure < 760);
});

test("depth quantization is stable at the 24-bit comparison scale", () => {
  const resolution = depthQuantization(24);
  const value = quantizeDepth(0.9234567, 24);
  const error = Math.abs(value - 0.9234567);
  assert.ok(error <= resolution / 2 + Number.EPSILON);
  assert.ok(settings.tolerance < resolution);
});

test("all camera stations produce finite diagnostics", () => {
  for (const station of CAMERA_STATIONS) {
    const result = analyzer.analyze(station, settings);
    assert.ok(result.total > 0);
    assert.ok(Number.isFinite(result.offsetMissed));
    assert.ok(Number.isFinite(result.depthMissed));
    assert.ok(Number.isFinite(result.averageEdgeDistance));
  }
});
