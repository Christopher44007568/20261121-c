import test from "node:test";
import assert from "node:assert/strict";
import { ASSEMBLY } from "../src/assembly-data.js";
import { createExplosionEngine } from "../src/explosion.js";
import { matricesEqual } from "../src/geometry.js";
import { createCamera } from "../src/scene-geometry.js";
import { createSceneLayout, labelCenter, pickScene } from "../src/scene.js";
import { analyzeConstraints, layoutConflictGraph } from "../src/constraints.js";

test("nested groups increase local travel and can be exploded in isolation", () => {
  const engine = createExplosionEngine();
  engine.setAxis("x");
  engine.setAmount(1);

  const shaft = engine.trajectory("input-shaft");
  const bearing = engine.trajectory("input-bearing");
  const gear = engine.trajectory("input-gear");
  assert.ok(bearing.delta.x < shaft.delta.x);
  assert.ok(gear.delta.x < bearing.delta.x);
  assert.ok(Math.abs(gear.delta.x) > Math.abs(bearing.delta.x));

  engine.setScope("input-gear-stack");
  assert.ok(engine.trajectory("input-gear").distance > 0);
  assert.ok(engine.trajectory("input-retainer").distance > 0);
  assert.equal(engine.trajectory("input-shaft").distance, 0);
  assert.equal(engine.trajectory("output-gear").distance, 0);
});

test("axial lock keeps all trajectory components on the selected axis", () => {
  const engine = createExplosionEngine();
  engine.setAxis("y");
  engine.setAmount(1);
  engine.setAxialLock(true);
  for (const part of engine.parts) {
    const delta = engine.trajectory(part.id).delta;
    assert.ok(Math.abs(delta.x) < 1e-12, `${part.id} drifted on x`);
    assert.ok(Math.abs(delta.z) < 1e-12, `${part.id} drifted on z`);
  }

  engine.setAxialLock(false);
  const drift = engine.parts.some((part) => {
    const delta = engine.trajectory(part.id).delta;
    return Math.abs(delta.x) > 1e-6 || Math.abs(delta.z) > 1e-6;
  });
  assert.equal(drift, true);
});

test("a locked part remains at its exact rest matrix", () => {
  const engine = createExplosionEngine();
  engine.setAxis("z");
  engine.setAmount(0.83);
  engine.setLocked("input-gear", true);
  assert.ok(matricesEqual(
    engine.matrixAt("input-gear"),
    engine.restMatrix("input-gear"),
    1e-12,
  ));
  assert.equal(engine.trajectory("input-gear").distance, 0);

  engine.setLocked("input-gear", false);
  assert.ok(engine.trajectory("input-gear").distance > 0);
});

test("camera changes do not mutate transforms and keep labels pickable", () => {
  const engine = createExplosionEngine();
  engine.setAmount(1);
  const before = engine.targetMatrices();
  const firstCamera = createCamera({ yaw: -0.71, pitch: 0.36, distance: 20.5 });
  const firstLayout = createSceneLayout(engine, firstCamera, { width: 1100, height: 650 });

  for (const item of firstLayout.labels) {
    const hit = pickScene(firstLayout, labelCenter(item));
    assert.equal(hit?.id, item.id);
    assert.equal(hit?.type, "label");
  }

  const secondCamera = createCamera({ yaw: 0.74, pitch: 0.2, distance: 22 });
  const secondLayout = createSceneLayout(engine, secondCamera, { width: 1100, height: 650 });
  for (const item of secondLayout.labels) {
    const hit = pickScene(secondLayout, labelCenter(item));
    assert.equal(hit?.id, item.id);
  }

  const firstAnchors = firstLayout.parts.map((item) => item.anchor.x + item.anchor.y);
  const secondAnchors = secondLayout.parts.map((item) => item.anchor.x + item.anchor.y);
  assert.notDeepEqual(firstAnchors, secondAnchors);
  const after = engine.targetMatrices();
  for (const [id, matrix] of before) {
    assert.ok(matricesEqual(matrix, after.get(id), 0));
  }
});

test("reset restores every matrix exactly after an arbitrary explosion", () => {
  const engine = createExplosionEngine();
  engine.setAxis("x");
  engine.setAmount(1);
  engine.setLocked("cover-seal", true);
  engine.targetMatrices();
  const reset = engine.reset();
  assert.equal(engine.state.amount, 0);
  for (const part of engine.parts) {
    assert.ok(matricesEqual(
      reset.get(part.id),
      engine.restMatrix(part.id),
      1e-12,
    ), `${part.id} was not restored`);
    assert.deepEqual(engine.positionAt(part.id), part.position);
  }
});

test("the fully exploded assembly increases the minimum non-touching clearance", () => {
  const engine = createExplosionEngine();
  engine.setAxis("x");
  engine.setAmount(0);
  const rest = engine.clearanceReport(0);
  engine.setAmount(1);
  const exploded = engine.clearanceReport(1);
  assert.ok(rest.distance > 0);
  assert.ok(exploded.distance > rest.distance * 3);
  assert.ok(exploded.distance > 0.1);
  assert.notDeepEqual(exploded.pair, []);
});

test("constraint analysis exposes the precedence cycle as a graph", () => {
  const analysis = analyzeConstraints(ASSEMBLY);
  assert.equal(analysis.conflictCount, 1);
  const cycle = new Set(analysis.cycles.flat());
  assert.ok(cycle.has("input-bearing"));
  assert.ok(cycle.has("input-shaft"));
  assert.equal(analysis.conflictEdges.length, 2);

  const graph = layoutConflictGraph(ASSEMBLY, 306, 166);
  assert.equal(graph.graphNodes.filter((node) => node.conflict).length, 2);
  assert.equal(graph.graphEdges.filter((edge) => edge.conflict).length, 2);
  for (const node of graph.graphNodes) {
    assert.ok(node.x >= 0 && node.x <= graph.width);
    assert.ok(node.y >= 0 && node.y <= graph.height);
  }
});

test("trajectories interpolate linearly and reverse without drift", () => {
  const engine = createExplosionEngine();
  engine.setAxis("x");
  engine.setAmount(0.25);
  const quarter = engine.positionAt("output-gear");
  engine.setAmount(0);
  const start = engine.positionAt("output-gear");
  engine.setAmount(1);
  const end = engine.positionAt("output-gear");
  engine.setAmount(0.25);
  const returned = engine.positionAt("output-gear");
  assert.ok(Math.abs(returned.x - quarter.x) < 1e-12);
  assert.ok(Math.abs(returned.y - quarter.y) < 1e-12);
  assert.ok(Math.abs(returned.z - quarter.z) < 1e-12);
  assert.ok(Math.abs((quarter.x - start.x) * 4 - (end.x - start.x)) < 1e-9);
  const rest = ASSEMBLY.nodes.find((node) => node.id === "output-gear").position;
  assert.deepEqual(start, rest);
});
