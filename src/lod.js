import { clamp, projectPoint, smoothstep } from "./math.js";
import { TREE } from "./scene.js";

// Transition band in projected pixels (matches HUD: 98 – 162 px).
export const LOD_BAND = { low: 98, high: 162 };

export const MODE = { AUTO: "auto", MESH: "mesh", PROXY: "proxy" };

// Projected tree height in screen pixels. Pure function of pose + intrinsics,
// so forward and reverse walks over the same position return identical values.
export function projectedHeightPx(mvp, tree, viewportH) {
  const base = projectPoint(mvp, tree.pos);
  if (!base) return 0;
  const topWorld = [
    tree.pos[0],
    tree.pos[1] + tree.height + TREE.tierH * 0.4 * tree.scale,
    tree.pos[2],
  ];
  const top = projectPoint(mvp, topWorld);
  if (!top) return 0;
  return Math.abs(top[1] - base[1]) * 0.5 * viewportH;
}

// 1 => full near mesh, 0 => full far proxy, between => cross-fade.
export function lodWeight(px, mode) {
  if (mode === MODE.MESH) return 1;
  if (mode === MODE.PROXY) return 0;
  if (px >= LOD_BAND.high) return 1;
  if (px <= LOD_BAND.low) return 0;
  return smoothstep(LOD_BAND.low, LOD_BAND.high, px);
}

export function classify(weight) {
  if (weight >= 1) return "mesh";
  if (weight <= 0) return "proxy";
  return "fade";
}

// Per-frame per-tree LOD record used by both renderer and telemetry.
export function evaluateFrame(trees, mvp, viewportH, mode, camPos) {
  let meshCount = 0;
  let proxyCount = 0;
  let fadeCount = 0;
  let triangles = 0;
  const records = [];
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const camDist = Math.hypot(tree.pos[0] - camPos[0], tree.pos[2] - camPos[2]);
    if (camDist > 240 || camDist < 8) continue;
    const px = projectedHeightPx(mvp, tree, viewportH);
    // Hard screen-size guard: a tree filling most of the screen means the
    // camera has walked past it, so skip rather than render a giant sliver.
    if (px > viewportH * 0.8) continue;
    const base = projectPoint(mvp, tree.pos);
    const topWorld = [
      tree.pos[0],
      tree.pos[1] + tree.height,
      tree.pos[2],
    ];
    const top = projectPoint(mvp, topWorld);
    // Frustum cull: behind camera or far outside the clip box.
    if (
      !base || !top || base[2] > 1 ||
      Math.abs(base[0]) > 1.4 ||
      Math.abs(top[0]) > 1.5 || top[1] > 1.6 ||
      base[1] < -1.5
    ) {
      continue;
    }
    const w = clamp(lodWeight(px, mode), 0, 1);
    const kind = classify(w);
    if (kind === "mesh") meshCount++;
    else if (kind === "proxy") proxyCount++;
    else fadeCount++;
    records.push({ index: i, treeId: tree.id, px, weight: w, kind });
  }
  return { records, meshCount, proxyCount, fadeCount, triangles };
}
