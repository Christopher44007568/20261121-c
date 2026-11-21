import { EPS, cross } from "./math.js";

function triangleIntersect(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-10) return -1;
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-7 || u > 1 + 1e-7) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-7 || u + v > 1 + 1e-7) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function rayAabb(ox, oy, oz, idx, idy, idz, minX, minY, minZ, maxX, maxY, maxZ, start, end) {
  let t0 = (minX - ox) * idx;
  let t1 = (maxX - ox) * idx;
  let tmin = Math.min(t0, t1);
  let tmax = Math.max(t0, t1);
  t0 = (minY - oy) * idy;
  t1 = (maxY - oy) * idy;
  tmin = Math.max(tmin, Math.min(t0, t1));
  tmax = Math.min(tmax, Math.max(t0, t1));
  t0 = (minZ - oz) * idz;
  t1 = (maxZ - oz) * idz;
  tmin = Math.max(tmin, Math.min(t0, t1));
  tmax = Math.min(tmax, Math.max(t0, t1));
  return tmax >= Math.max(start, tmin) && tmin <= end;
}

export class BVH {
  constructor(mesh) {
    this.mesh = mesh;
    this.triangles = [];
    const { positions, indices } = mesh;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i];
      const ib = indices[i + 1];
      const ic = indices[i + 2];
      const ax = positions[ia * 3];
      const ay = positions[ia * 3 + 1];
      const az = positions[ia * 3 + 2];
      const bx = positions[ib * 3];
      const by = positions[ib * 3 + 1];
      const bz = positions[ib * 3 + 2];
      const cx = positions[ic * 3];
      const cy = positions[ic * 3 + 1];
      const cz = positions[ic * 3 + 2];
      const normal = cross(
        [bx - ax, by - ay, bz - az],
        [cx - ax, cy - ay, cz - az]
      );
      const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
      normal[0] /= len;
      normal[1] /= len;
      normal[2] /= len;
      const part = Math.round(mesh.partIds?.[ia] ?? 0);
      this.triangles.push({
        face: i / 3,
        part,
        a: [ax, ay, az],
        b: [bx, by, bz],
        c: [cx, cy, cz],
        nx: normal[0],
        ny: normal[1],
        nz: normal[2],
        cx: (ax + bx + cx) / 3,
        cy: (ay + by + cy) / 3,
        cz: (az + bz + cz) / 3
      });
    }
    this.centroids = new Float32Array(this.triangles.length * 3);
    this.triangles.forEach((tri, i) => {
      this.centroids[i * 3] = tri.cx;
      this.centroids[i * 3 + 1] = tri.cy;
      this.centroids[i * 3 + 2] = tri.cz;
    });
    this.indices = new Uint32Array(this.triangles.length);
    for (let i = 0; i < this.indices.length; i++) this.indices[i] = i;
    this.root = this.build(0, this.triangles.length);
  }

  bounds(start, end) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const tri = this.triangles[this.indices[i]];
      for (const p of [tri.a, tri.b, tri.c]) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        minZ = Math.min(minZ, p[2]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
        maxZ = Math.max(maxZ, p[2]);
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  build(start, end) {
    const bounds = this.bounds(start, end);
    if (end - start <= 5) return { ...bounds, start, end, left: null, right: null };
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const spanZ = bounds.maxZ - bounds.minZ;
    const axis = spanX > spanY && spanX > spanZ ? 0 : spanY > spanZ ? 1 : 2;
    const slice = Array.from(this.indices.subarray(start, end));
    const offset = axis;
    slice.sort((a, b) => this.centroids[a * 3 + offset] - this.centroids[b * 3 + offset]);
    this.indices.set(slice, start);
    const middle = (start + end) >> 1;
    return {
      ...bounds,
      start,
      end,
      left: this.build(start, middle),
      right: this.build(middle, end)
    };
  }

  occluded(origin, direction, maxDistance, options = {}) {
    const ox = origin[0];
    const oy = origin[1];
    const oz = origin[2];
    const dx = direction[0];
    const dy = direction[1];
    const dz = direction[2];
    const idx = 1 / (Math.abs(dx) > EPS ? dx : EPS * Math.sign(dx || 1));
    const idy = 1 / (Math.abs(dy) > EPS ? dy : EPS * Math.sign(dy || 1));
    const idz = 1 / (Math.abs(dz) > EPS ? dz : EPS * Math.sign(dz || 1));
    const sourcePart = options.sourcePart ?? -1;
    const sourceFace = options.sourceFace ?? -1;
    const suppression = options.suppression !== false;
    const tMin = options.tMin ?? 1e-5;
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      if (!rayAabb(
        ox, oy, oz, idx, idy, idz,
        node.minX, node.minY, node.minZ, node.maxX, node.maxY, node.maxZ,
        tMin, maxDistance
      )) continue;
      if (node.left) {
        stack.push(node.right, node.left);
        continue;
      }
      for (let i = node.start; i < node.end; i++) {
        const tri = this.triangles[this.indices[i]];
        if (suppression && tri.part === sourcePart) continue;
        if (tri.face === sourceFace) continue;
        const t = triangleIntersect(
          ox, oy, oz, dx, dy, dz,
          tri.a[0], tri.a[1], tri.a[2],
          tri.b[0], tri.b[1], tri.b[2],
          tri.c[0], tri.c[1], tri.c[2]
        );
        if (t > tMin && t < maxDistance) return true;
      }
    }
    return false;
  }

  intersect(origin, direction, maxDistance, options = {}) {
    const suppression = options.suppression !== false;
    const sourcePart = options.sourcePart ?? -1;
    const sourceFace = options.sourceFace ?? -1;
    const tMin = options.tMin ?? 1e-6;
    const ox = origin[0];
    const oy = origin[1];
    const oz = origin[2];
    const dx = direction[0];
    const dy = direction[1];
    const dz = direction[2];
    const idx = 1 / (Math.abs(dx) > EPS ? dx : EPS * Math.sign(dx || 1));
    const idy = 1 / (Math.abs(dy) > EPS ? dy : EPS * Math.sign(dy || 1));
    const idz = 1 / (Math.abs(dz) > EPS ? dz : EPS * Math.sign(dz || 1));
    const stack = [{ node: this.root, near: 0 }];
    let best = maxDistance;
    let hit = null;
    while (stack.length) {
      const { node, near } = stack.pop();
      if (near > best) continue;
      if (!rayAabb(
        ox, oy, oz, idx, idy, idz,
        node.minX, node.minY, node.minZ, node.maxX, node.maxY, node.maxZ,
        tMin, best
      )) continue;
      if (node.left) {
        stack.push({ node: node.left, near }, { node: node.right, near });
        continue;
      }
      for (let i = node.start; i < node.end; i++) {
        const tri = this.triangles[this.indices[i]];
        if (suppression && tri.part === sourcePart) continue;
        if (tri.face === sourceFace) continue;
        const t = triangleIntersect(
          ox, oy, oz, dx, dy, dz,
          tri.a[0], tri.a[1], tri.a[2],
          tri.b[0], tri.b[1], tri.b[2],
          tri.c[0], tri.c[1], tri.c[2]
        );
        if (t > tMin && t < best) {
          best = t;
          hit = { ...tri, distance: t };
        }
      }
    }
    return hit;
  }
}
