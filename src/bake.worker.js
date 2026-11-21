import { bakeLightmap, bakeVertexAO, DEFAULT_BAKE } from "./ao.js";
import { BVH } from "./bvh.js";
import { createScene } from "./scenes.js";

const cache = new Map();

function getScene(sceneId) {
  if (!cache.has(sceneId)) {
    const scene = createScene(sceneId);
    cache.set(sceneId, { scene, bvh: new BVH(scene.mesh) });
  }
  return cache.get(sceneId);
}

self.onmessage = (event) => {
  const { type, requestId, sceneId, config } = event.data || {};
  if (type !== "bake") return;
  try {
    const { scene, bvh } = getScene(sceneId);
    const bakeConfig = { ...DEFAULT_BAKE, ...config, bvh };
    const progress = (value) => {
      self.postMessage({ type: "progress", requestId, value });
    };
    const result = bakeConfig.mode === "lightmap"
      ? bakeLightmap(scene, bakeConfig, progress)
      : bakeVertexAO(scene, bakeConfig, progress);
    const transfers = [];
    if (result.ao) transfers.push(result.ao.buffer);
    if (result.blockedWeight) transfers.push(result.blockedWeight.buffer);
    if (result.vertexFaces) transfers.push(result.vertexFaces.buffer);
    if (result.layers) {
      for (const layer of result.layers) {
        transfers.push(layer.data.buffer, layer.coverage.buffer);
      }
    }
    self.postMessage({
      type: "result",
      requestId,
      sceneId,
      result: {
        ...result,
        vertexCount: scene.vertexCount,
        triangleCount: scene.triangleCount
      }
    }, transfers);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : ""
    });
  }
};
