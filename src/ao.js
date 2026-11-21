import { BVH } from "./bvh.js";
import { buildSampleDirections, sampleWeight } from "./sampling.js";
import { clamp, dot, normalize } from "./math.js";

export const DEFAULT_BAKE = Object.freeze({
  samples: 64,
  maxDistance: 2.4,
  directionality: 1,
  suppression: true,
  seed: 1,
  mode: "vertex"
});

export function buildVertexFaces(mesh) {
  const faces = new Map();
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    for (let k = 0; k < 3; k++) {
      const vertex = mesh.indices[face * 3 + k];
      if (!faces.has(vertex)) faces.set(vertex, []);
      faces.get(vertex).push(face);
    }
  }
  return faces;
}

export function sampleAO(point, normal, bvh, options) {
  const count = Math.max(1, Math.round(options.samples || 1));
  const maxDistance = Math.max(1e-4, options.maxDistance || 1);
  const suppression = options.suppression !== false;
  const directionality = options.directionality ?? 1;
  const seed = options.seed ?? 1;
  const sourcePart = options.sourcePart ?? -1;
  const sourceFace = options.sourceFace ?? -1;
  const bias = suppression ? Math.max(2e-4, maxDistance * 6e-4) : 0;
  const origin = [
    point[0] + normal[0] * bias,
    point[1] + normal[1] * bias,
    point[2] + normal[2] * bias
  ];
  const directions = buildSampleDirections(normal, count, seed, directionality);
  let visible = 0;
  let total = 0;
  let suppressedSelfHits = 0;
  for (let i = 0; i < count; i++) {
    const direction = [
      directions[i * 3],
      directions[i * 3 + 1],
      directions[i * 3 + 2]
    ];
    const weight = sampleWeight(direction, normal);
    if (weight <= 0) continue;
    total += weight;
    const blocked = bvh.occluded(origin, direction, maxDistance, {
      suppression,
      sourcePart,
      sourceFace,
      tMin: suppression ? Math.max(1e-5, bias * 0.25) : 1e-7
    });
    if (!blocked) visible += weight;
  }
  const ao = total > 0 ? clamp(visible / total, 0, 1) : 1;
  return {
    ao,
    blockedFraction: 1 - ao,
    suppressedSelfHits,
    origin,
    directions
  };
}

export function bakeVertexAO(scene, options = {}, progress = null) {
  const start = performance.now();
  const config = { ...DEFAULT_BAKE, ...options, mode: "vertex" };
  const bvh = options.bvh || new BVH(scene.mesh);
  const { positions, normals, partIds } = scene.mesh;
  const vertexCount = positions.length / 3;
  const faces = buildVertexFaces(scene.mesh);
  const ao = new Float32Array(vertexCount);
  const blockedWeight = new Float32Array(vertexCount);
  const vertexFaces = new Uint32Array(vertexCount);
  let sum = 0;
  let dark = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    const normal = [normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]];
    const adjacent = faces.get(vertex);
    const sourceFace = adjacent?.[0] ?? -1;
    vertexFaces[vertex] = sourceFace;
    const result = sampleAO(point, normal, bvh, {
      ...config,
      seed: (config.seed + vertex * 2654435761) >>> 0,
      sourcePart: Math.round(partIds[vertex]),
      sourceFace
    });
    ao[vertex] = result.ao;
    blockedWeight[vertex] = result.blockedFraction;
    sum += result.ao;
    if (result.ao < 0.02) dark++;
    if (progress && (vertex % 64 === 0 || vertex === vertexCount - 1)) {
      progress((vertex + 1) / vertexCount);
    }
  }
  return {
    mode: "vertex",
    ao,
    blockedWeight,
    vertexFaces,
    averageAO: sum / vertexCount,
    darkFraction: dark / vertexCount,
    blockedFraction: blockedWeight.reduce((acc, value) => acc + value, 0) / vertexCount,
    samples: config.samples,
    maxDistance: config.maxDistance,
    directionality: config.directionality,
    suppression: config.suppression,
    seed: config.seed,
    vertexCount,
    triangleCount: scene.mesh.indices.length / 3,
    ms: performance.now() - start
  };
}

function barycentric(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return null;
  const w0 = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const w1 = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [w0, w1, 1 - w0 - w1];
}

function interpolate3(values, indices, weights) {
  return [
    values[indices[0] * 3] * weights[0] + values[indices[1] * 3] * weights[1] + values[indices[2] * 3] * weights[2],
    values[indices[0] * 3 + 1] * weights[0] + values[indices[1] * 3 + 1] * weights[1] + values[indices[2] * 3 + 1] * weights[2],
    values[indices[0] * 3 + 2] * weights[0] + values[indices[1] * 3 + 2] * weights[1] + values[indices[2] * 3 + 2] * weights[2]
  ];
}

export function bakeLightmap(scene, options = {}, progress = null) {
  const start = performance.now();
  const config = { ...DEFAULT_BAKE, ...options, mode: "lightmap" };
  const size = Math.max(32, Math.min(512, Math.round(options.lightmapSize || 128)));
  const bvh = options.bvh || new BVH(scene.mesh);
  const layers = [];
  const totalTriangles = scene.mesh.indices.length / 3;
  let doneTriangles = 0;
  for (let partIndex = 0; partIndex < scene.parts.length; partIndex++) {
    const part = scene.parts[partIndex];
    const data = new Float32Array(size * size).fill(1);
    const coverage = new Uint8Array(size * size);
    for (let t = 0; t < part.indices.length; t += 3) {
      const indices = [
        part.indices[t] + part.vertexStart,
        part.indices[t + 1] + part.vertexStart,
        part.indices[t + 2] + part.vertexStart
      ];
      const uv = indices.map((index) => [
        scene.mesh.uvs[index * 2],
        scene.mesh.uvs[index * 2 + 1]
      ]);
      const minX = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[0])) * size) - 1);
      const maxX = Math.min(size - 1, Math.ceil(Math.max(...uv.map((p) => p[0])) * size) + 1);
      const minY = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[1])) * size) - 1);
      const maxY = Math.min(size - 1, Math.ceil(Math.max(...uv.map((p) => p[1])) * size) + 1);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const texel = [(x + 0.5) / size, (y + 0.5) / size];
          const [w0, w1, w2] = barycentric(
            texel,
            [uv[0][0], uv[0][1]],
            [uv[1][0], uv[1][1]],
            [uv[2][0], uv[2][1]]
          ) || [];
          if (w0 === undefined) continue;
          if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
          const point = interpolate3(scene.mesh.positions, indices, [w0, w1, w2]);
          const normal = normalize(interpolate3(scene.mesh.normals, indices, [w0, w1, w2]));
          const result = sampleAO(point, normal, bvh, {
            ...config,
            seed: (config.seed + ((x * 73856093) ^ (y * 19349663))) >>> 0,
            sourcePart: partIndex,
            sourceFace: t / 3 + part.indexStart / 3
          });
          const pixel = y * size + x;
          data[pixel] = result.ao;
          coverage[pixel] = 1;
        }
      }
      doneTriangles++;
      if (progress) {
        progress(clamp(doneTriangles / totalTriangles, 0, 1));
      }
    }
    layers.push({ partIndex, partId: part.id, name: part.name, data, coverage });
  }
  return {
    mode: "lightmap",
    size,
    layers,
    averageAO: layers.reduce((sum, layer) => {
      let count = 0;
      let value = 0;
      for (let i = 0; i < layer.data.length; i++) {
        if (layer.coverage[i]) {
          value += layer.data[i];
          count++;
        }
      }
      return sum + (count ? value / count : 1);
    }, 0) / layers.length,
    samples: config.samples,
    maxDistance: config.maxDistance,
    directionality: config.directionality,
    suppression: config.suppression,
    seed: config.seed,
    vertexCount: scene.vertexCount,
    triangleCount: scene.triangleCount,
    ms: performance.now() - start
  };
}
