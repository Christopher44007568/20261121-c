import assert from "node:assert/strict";
import test from "node:test";
import { bakeLightmap, bakeVertexAO } from "../src/ao.js";
import { computeConvergence, computeDiagnostics, computeReference } from "../src/analysis.js";
import { BVH } from "../src/bvh.js";
import { createScene, SCENE_IDS } from "../src/scenes.js";

function scene(id) {
  const value = createScene(id);
  return { value, bvh: new BVH(value.mesh) };
}

test("procedural scenes contain finite, oriented triangles", () => {
  assert.deepEqual(SCENE_IDS, ["sphere-plane", "edge-contact", "stacked-gap"]);
  for (const id of SCENE_IDS) {
    const { value } = scene(id);
    assert.ok(value.vertexCount > 1000);
    assert.ok(value.triangleCount > 1000);
    assert.equal(value.mesh.indices.length, value.triangleCount * 3);
    for (const part of value.parts) {
      for (let i = 0; i < part.indices.length; i += 3) {
        const ids = [part.indices[i], part.indices[i + 1], part.indices[i + 2]];
        const points = ids.map((index) => [
          part.positions[index * 3],
          part.positions[index * 3 + 1],
          part.positions[index * 3 + 2]
        ]);
        const u = points[1].map((value, axis) => value - points[0][axis]);
        const v = points[2].map((value, axis) => value - points[0][axis]);
        const normal = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]
        ];
        const vertexNormal = [
          part.normals[ids[0] * 3],
          part.normals[ids[0] * 3 + 1],
          part.normals[ids[0] * 3 + 2]
        ];
        assert.ok(
          normal[0] * vertexNormal[0] + normal[1] * vertexNormal[1] + normal[2] * vertexNormal[2] > 0,
          `${id}/${part.id} triangle winding`
        );
      }
    }
  }
});

test("BVH respects distance bounds and source-part suppression", () => {
  const { bvh } = scene("sphere-plane");
  const withoutSuppression = bvh.occluded([0, 3.2, 0], [0, -1, 0], 2.5, {
    suppression: false,
    sourcePart: 1
  });
  const withSuppression = bvh.occluded([0, 3.2, 0], [0, -1, 0], 2.5, {
    suppression: true,
    sourcePart: 1
  });
  assert.equal(withoutSuppression, true);
  assert.equal(withSuppression, false);
  assert.equal(bvh.occluded([0, 3.2, 0], [0, -1, 0], 0.2, {
    suppression: false,
    sourcePart: 1
  }), false);
});

test("vertex AO is deterministic and normal-oriented", () => {
  const { value, bvh } = scene("sphere-plane");
  const first = bakeVertexAO(value, {
    bvh,
    samples: 16,
    maxDistance: 2.4,
    suppression: true,
    seed: 7
  });
  const second = bakeVertexAO(value, {
    bvh,
    samples: 16,
    maxDistance: 2.4,
    suppression: true,
    seed: 7
  });
  assert.deepEqual(Array.from(first.ao), Array.from(second.ao));
  assert.ok(first.averageAO > 0.6 && first.averageAO < 0.95);
  assert.equal(first.ao.length, value.vertexCount);
  const sphere = value.parts[1];
  const top = sphere.vertexStart;
  assert.ok(first.ao[top] > 0.98, "sphere top should have unoccluded sky");
});

test("sample count and max distance are independent controls", () => {
  const { value, bvh } = scene("stacked-gap");
  const lowSamples = bakeVertexAO(value, {
    bvh,
    samples: 8,
    maxDistance: 1.2,
    suppression: true,
    seed: 2
  });
  const highSamples = bakeVertexAO(value, {
    bvh,
    samples: 32,
    maxDistance: 1.2,
    suppression: true,
    seed: 2
  });
  const shortRange = bakeVertexAO(value, {
    bvh,
    samples: 32,
    maxDistance: 0.2,
    suppression: true,
    seed: 2
  });
  assert.notEqual(lowSamples.averageAO, highSamples.averageAO);
  assert.ok(shortRange.averageAO >= highSamples.averageAO);
});

test("lightmap bake produces covered per-part layers", () => {
  const { value, bvh } = scene("edge-contact");
  const result = bakeLightmap(value, {
    bvh,
    samples: 4,
    maxDistance: 2.4,
    suppression: true,
    lightmapSize: 32,
    seed: 3
  });
  assert.equal(result.mode, "lightmap");
  assert.equal(result.layers.length, value.parts.length);
  for (const layer of result.layers) {
    let covered = 0;
    for (let i = 0; i < layer.data.length; i++) {
      if (layer.coverage[i]) {
        covered++;
        assert.ok(layer.data[i] >= 0 && layer.data[i] <= 1);
      }
    }
    assert.ok(covered > layer.data.length * 0.4);
  }
});

test("convergence decreases error and diagnostics identify points", () => {
  const { value, bvh } = scene("stacked-gap");
  const reference = computeReference(value, { bvh, samples: 32 });
  const convergence = computeConvergence(value, {
    bvh,
    reference,
    sampleCounts: [4, 8, 16],
    seeds: [1]
  });
  assert.ok(convergence.series.at(-1).rmse < convergence.series[0].rmse);
  const diagnostics = computeDiagnostics(value, reference, { bvh, seed: 16 });
  assert.ok(diagnostics.total > 0);
  for (const point of diagnostics.points) {
    assert.equal(point.position.length, 3);
    assert.equal(typeof point.part, "string");
    assert.ok(point.referenceAO > point.ao);
  }
});
