import { bakeVertexAO, buildVertexFaces, DEFAULT_BAKE } from "./ao.js";
import { BVH } from "./bvh.js";
import { createScene, getSceneMeta } from "./scenes.js";

export const SAMPLE_COUNTS = [4, 8, 16, 32, 64, 128, 256, 512];
const TEST_SEEDS = [1, 2, 3];
const DISTANCE_STEPS = [0.2, 0.4, 0.7, 1.2, 2.4, 4.8];

export function computeReference(scene, options = {}) {
  const bvh = options.bvh || new BVH(scene.mesh);
  const bake = bakeVertexAO(scene, {
    ...DEFAULT_BAKE,
    maxDistance: scene.maxDistance,
    samples: options.samples || 512,
    suppression: true,
    seed: 1,
    bvh
  });
  return {
    caseId: scene.id,
    samples: bake.samples,
    maxDistance: bake.maxDistance,
    ao: Array.from(bake.ao),
    averageAO: bake.averageAO,
    ms: bake.ms
  };
}

function metrics(values, reference, quantize = false) {
  let squared = 0;
  let absolute = 0;
  let maxError = 0;
  let darkMismatch = 0;
  for (let i = 0; i < values.length; i++) {
    let value = values[i];
    if (quantize) value = Math.round(value * 255) / 255;
    const error = Math.abs(value - reference[i]);
    squared += error * error;
    absolute += error;
    maxError = Math.max(maxError, error);
    if (reference[i] > 0.15 && value < Math.max(0.02, reference[i] * 0.35)) darkMismatch++;
  }
  return {
    rmse: Math.sqrt(squared / values.length),
    mae: absolute / values.length,
    maxError,
    darkMismatch
  };
}

export function computeConvergence(scene, options = {}) {
  const bvh = options.bvh || new BVH(scene.mesh);
  const reference = options.reference || computeReference(scene, { bvh });
  const counts = options.sampleCounts || SAMPLE_COUNTS;
  const seeds = options.seeds || TEST_SEEDS;
  const series = [];
  for (const samples of counts) {
    let total = { rmse: 0, mae: 0, maxError: 0, darkMismatch: 0 };
    let averageMs = 0;
    for (const seed of seeds) {
      const bake = bakeVertexAO(scene, {
        maxDistance: scene.maxDistance,
        samples,
        suppression: true,
        directionality: 1,
        seed,
        bvh
      });
      const measured = metrics(bake.ao, reference.ao, true);
      for (const key of Object.keys(total)) total[key] += measured[key];
      averageMs += bake.ms;
    }
    const divisor = seeds.length;
    series.push({
      samples,
      rmse: total.rmse / divisor,
      mae: total.mae / divisor,
      maxError: total.maxError / divisor,
      darkMismatch: Math.round(total.darkMismatch / divisor),
      averageMs: averageMs / divisor
    });
  }
  return { reference, series };
}

export function computeDistanceSweep(scene, options = {}) {
  const bvh = options.bvh || new BVH(scene.mesh);
  return (options.distances || DISTANCE_STEPS).map((maxDistance) => {
    const bake = bakeVertexAO(scene, {
      samples: options.samples || 64,
      maxDistance,
      suppression: true,
      directionality: 1,
      seed: 1,
      bvh
    });
    return {
      maxDistance,
      averageAO: bake.averageAO,
      darkFraction: bake.darkFraction,
      blockedFraction: bake.blockedFraction
    };
  });
}

function vertexNeighbors(mesh) {
  const neighbors = Array.from({ length: mesh.positions.length / 3 }, () => new Set());
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  return neighbors;
}

function partForVertex(scene, vertex) {
  for (let i = 0; i < scene.parts.length; i++) {
    const part = scene.parts[i];
    const start = part.vertexStart;
    const end = start + part.positions.length / 3;
    if (vertex >= start && vertex < end) return { part, local: vertex - start };
  }
  return { part: scene.parts[0], local: vertex };
}

export function computeDiagnostics(scene, reference, options = {}) {
  const bvh = options.bvh || new BVH(scene.mesh);
  const samples = options.samples || 4;
  const seed = options.seed ?? 10;
  const stress = bakeVertexAO(scene, {
    samples,
    maxDistance: scene.maxDistance,
    suppression: false,
    directionality: 1,
    seed,
    bvh
  });
  const neighbors = vertexNeighbors(scene.mesh);
  const points = [];
  for (let vertex = 0; vertex < stress.ao.length; vertex++) {
    if (
      reference.ao[vertex] <= 0.15 ||
      stress.ao[vertex] >= Math.max(0.02, reference.ao[vertex] * 0.55)
    ) continue;
    const neighborValues = Array.from(neighbors[vertex]).map((index) => reference.ao[index]);
    const neighborAO = neighborValues.length
      ? neighborValues.reduce((sum, value) => sum + value, 0) / neighborValues.length
      : 1;
    const { part, local } = partForVertex(scene, vertex);
    points.push({
      vertex,
      localVertex: local,
      part: part.name,
      partId: part.id,
      position: [
        scene.mesh.positions[vertex * 3],
        scene.mesh.positions[vertex * 3 + 1],
        scene.mesh.positions[vertex * 3 + 2]
      ],
      normal: [
        scene.mesh.normals[vertex * 3],
        scene.mesh.normals[vertex * 3 + 1],
        scene.mesh.normals[vertex * 3 + 2]
      ],
      ao: stress.ao[vertex],
      referenceAO: reference.ao[vertex],
      neighborAO,
      score: reference.ao[vertex] - stress.ao[vertex],
      suppressedSelfHits: 0
    });
  }
  points.sort((a, b) => b.score - a.score);
  return {
    samples,
    seed,
    suppression: false,
    total: points.length,
    points
  };
}

export function computeCaseStudy(id, options = {}) {
  const scene = createScene(id);
  const meta = getSceneMeta(id);
  const bvh = new BVH(scene.mesh);
  const reference = computeReference(scene, { bvh, samples: options.referenceSamples || 512 });
  const convergence = computeConvergence(scene, {
    bvh,
    reference,
    sampleCounts: options.sampleCounts,
    seeds: options.seeds
  });
  const distanceSweep = computeDistanceSweep(scene, { bvh });
  const diagnostics = computeDiagnostics(scene, reference, {
    bvh,
    seed: options.diagnosticSeed ?? 10
  });
  return {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    maxDistance: meta.maxDistance,
    referenceSamples: reference.samples,
    vertexCount: scene.vertexCount,
    triangleCount: scene.triangleCount,
    referenceMs: reference.ms,
    series: convergence.series,
    distanceSweep,
    reference,
    diagnostics
  };
}
