import { hash2 } from "./math.js";

// World layout: x across the valley, z down the slope (camera walks +z).
export const WORLD = {
  halfX: 110,
  zMin: -140,
  zMax: 150,
};

// Gentle continuous slope plus low rolling noise. Trees and camera share it.
export function terrainHeight(x, z) {
  const slope = -0.052 * z;
  const roll =
    1.7 * Math.sin(x * 0.045 + z * 0.02) +
    1.1 * Math.sin(x * 0.013 - z * 0.035 + 2.1);
  return slope + roll;
}

export const TREE = {
  trunkH: 2.6,
  trunkR: 0.2,
  tiers: 4,
  tierH: 2.3,
  baseR: 1.7,
  radialSeg: 8,
};

// One near-mesh tree: trunk (cylinder) + stacked tapered cones.
export function meshTriangleCount() {
  const { radialSeg, tiers } = TREE;
  const trunk = radialSeg * 2; // cylinder side
  const cone = radialSeg * 2; // cone side (base + apex fans)
  return trunk + tiers * cone;
}

// Proxy: one billboard card + one ground shadow blob quad.
export const PROXY_TRIANGLES = 2 + 2;

export function buildTrees() {
  const trees = [];
  const spacing = 8.5;
  let id = 0;
  for (let gz = WORLD.zMin; gz <= WORLD.zMax; gz += spacing) {
    const row = Math.round((gz - WORLD.zMin) / spacing);
    for (let gx = -WORLD.halfX; gx <= WORLD.halfX; gx += spacing) {
      const col = Math.round((gx + WORLD.halfX) / spacing);
      const keep = hash2(col, row);
      if (keep < 0.16) continue; // gaps / clearings
      const jitterX = (hash2(col * 7 + 1, row * 13 + 3) - 0.5) * spacing * 0.8;
      const jitterZ = (hash2(col * 11 + 5, row * 17 + 9) - 0.5) * spacing * 0.8;
      const x = gx + jitterX;
      const z = gx * 0 + gz + jitterZ;
      // Keep a clear corridor that follows the winding camera centerline.
      const pathX = 6 * Math.sin(z * 0.05);
      if (Math.abs(x - pathX) < 10) continue;
      const scale = 0.72 + hash2(col + 31, row + 47) * 0.62;
      const yaw = hash2(col + 61, row + 71) * Math.PI * 2;
      trees.push({
        id: id++,
        pos: [x, terrainHeight(x, z), z],
        scale,
        yaw,
        height: scale * (TREE.trunkH + TREE.tiers * TREE.tierH),
      });
    }
  }
  return trees;
}

// Camera path: follows the same slope, slightly above ground, looking downhill.
export function cameraPose(z) {
  const x = 6 * Math.sin(z * 0.05);
  const eye = [x, terrainHeight(x, z) + 6.5, z];
  const lookZ = z + 26;
  const look = [x * 0.5, terrainHeight(x, z) + 5.5, lookZ];
  return { eye, look };
}
