export const SCREEN = Object.freeze({
  width: 2.4,
  height: 1.6,
  thickness: 0.045,
  columns: 15,
  rows: 10,
  cell: 0.16,
  radius: 0.054,
  segments: 32,
});

function makeMesh() {
  return { positions: [], normals: [], uvs: [], useAlpha: [] };
}

function addVertex(mesh, p, n, uv, useAlpha) {
  mesh.positions.push(p[0], p[1], p[2]);
  mesh.normals.push(n[0], n[1], n[2]);
  mesh.uvs.push(uv[0], uv[1]);
  mesh.useAlpha.push(useAlpha);
}

function addTriangle(mesh, a, b, c, normal, ua, ub, uc, useAlpha) {
  addVertex(mesh, a, normal, ua, useAlpha);
  addVertex(mesh, b, normal, ub, useAlpha);
  addVertex(mesh, c, normal, uc, useAlpha);
}

function addQuad(mesh, a, b, c, d, normal, uvs, useAlpha) {
  addTriangle(mesh, a, b, c, normal, uvs[0], uvs[1], uvs[2], useAlpha);
  addTriangle(mesh, a, c, d, normal, uvs[0], uvs[2], uvs[3], useAlpha);
}

function toTyped(mesh) {
  return {
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    uvs: new Float32Array(mesh.uvs),
    useAlpha: new Float32Array(mesh.useAlpha),
    vertexCount: mesh.positions.length / 3,
  };
}

function uvFor(screen, x, y, z) {
  return [(x / screen.width + 0.5), (y / screen.height + 0.5)];
}

function addOuterWalls(mesh, screen, useAlpha) {
  const w = screen.width / 2;
  const h = screen.height / 2;
  const t = screen.thickness / 2;
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  addQuad(mesh, [w, -h, -t], [w, -h, t], [w, h, t], [w, h, -t], [1, 0, 0], uv, useAlpha);
  addQuad(mesh, [-w, -h, t], [-w, -h, -t], [-w, h, -t], [-w, h, t], [-1, 0, 0], uv, useAlpha);
  addQuad(mesh, [-w, h, -t], [w, h, -t], [w, h, t], [-w, h, t], [0, 1, 0], uv, useAlpha);
  addQuad(mesh, [-w, -h, t], [w, -h, t], [w, -h, -t], [-w, -h, -t], [0, -1, 0], uv, useAlpha);
}

export function buildAlphaPlate(screen = SCREEN) {
  const mesh = makeMesh();
  const w = screen.width / 2;
  const h = screen.height / 2;
  const t = screen.thickness / 2;
  const corners = [
    [-w, -h], [w, -h], [w, h], [-w, h],
  ];

  addQuad(
    mesh,
    [corners[0][0], corners[0][1], t],
    [corners[1][0], corners[1][1], t],
    [corners[2][0], corners[2][1], t],
    [corners[3][0], corners[3][1], t],
    [0, 0, 1],
    corners.map(([x, y]) => uvFor(screen, x, y, t)),
    1,
  );
  addQuad(
    mesh,
    [corners[0][0], corners[0][1], -t],
    [corners[3][0], corners[3][1], -t],
    [corners[2][0], corners[2][1], -t],
    [corners[1][0], corners[1][1], -t],
    [0, 0, -1],
    [corners[0], corners[3], corners[2], corners[1]].map(([x, y]) => uvFor(screen, x, y, -t)),
    1,
  );
  addOuterWalls(mesh, screen, 0);
  return toTyped(mesh);
}

function addCellSurface(mesh, screen, cx, cy, front) {
  const half = screen.cell / 2;
  const r = screen.radius;
  const z = front ? screen.thickness / 2 : -screen.thickness / 2;
  const normal = front ? [0, 0, 1] : [0, 0, -1];
  const uvAt = (x, y) => uvFor(screen, x, y, z);
  const seg = screen.segments;
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const d0 = Math.max(Math.abs(c0), Math.abs(s0));
    const d1 = Math.max(Math.abs(c1), Math.abs(s1));
    const inner0 = [cx + c0 * r, cy + s0 * r, z];
    const inner1 = [cx + c1 * r, cy + s1 * r, z];
    const outer0 = [cx + (c0 / d0) * half, cy + (s0 / d0) * half, z];
    const outer1 = [cx + (c1 / d1) * half, cy + (s1 / d1) * half, z];
    const u0 = uvAt(inner0[0], inner0[1]);
    const u1 = uvAt(inner1[0], inner1[1]);
    const u2 = uvAt(outer1[0], outer1[1]);
    const u3 = uvAt(outer0[0], outer0[1]);
    if (front) {
      addTriangle(mesh, inner0, inner1, outer1, normal, u0, u1, u2, 0);
      addTriangle(mesh, inner0, outer1, outer0, normal, u0, u2, u3, 0);
    } else {
      addTriangle(mesh, inner0, outer1, inner1, normal, u0, u2, u1, 0);
      addTriangle(mesh, inner0, outer0, outer1, normal, u0, u3, u2, 0);
    }
  }
}

function addHoleWall(mesh, screen, cx, cy) {
  const r = screen.radius;
  const t = screen.thickness / 2;
  const seg = screen.segments;
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const n0 = [-c0, -s0, 0];
    const n1 = [-c1, -s1, 0];
    const f0 = [cx + c0 * r, cy + s0 * r, t];
    const f1 = [cx + c1 * r, cy + s1 * r, t];
    const b0 = [cx + c0 * r, cy + s0 * r, -t];
    const b1 = [cx + c1 * r, cy + s1 * r, -t];
    const uv0 = uvFor(screen, f0[0], f0[1], t);
    const uv1 = uvFor(screen, f1[0], f1[1], t);
    addVertex(mesh, f0, n0, uv0, 0);
    addVertex(mesh, b0, n0, uv0, 0);
    addVertex(mesh, b1, n1, uv1, 0);
    addVertex(mesh, f0, n0, uv0, 0);
    addVertex(mesh, b1, n1, uv1, 0);
    addVertex(mesh, f1, n1, uv1, 0);
  }
}

export function buildScreenGeometry(screen = SCREEN) {
  const mesh = makeMesh();
  const startX = -screen.width / 2 + screen.cell / 2;
  const startY = -screen.height / 2 + screen.cell / 2;
  for (let row = 0; row < screen.rows; row += 1) {
    for (let col = 0; col < screen.columns; col += 1) {
      const cx = startX + col * screen.cell;
      const cy = startY + row * screen.cell;
      addCellSurface(mesh, screen, cx, cy, true);
      addCellSurface(mesh, screen, cx, cy, false);
      addHoleWall(mesh, screen, cx, cy);
    }
  }
  addOuterWalls(mesh, screen, 0);
  return toTyped(mesh);
}

export function buildContourLines(screen = SCREEN) {
  const lines = [];
  const z = screen.thickness / 2 + 0.001;
  const startX = -screen.width / 2 + screen.cell / 2;
  const startY = -screen.height / 2 + screen.cell / 2;
  const seg = 48;
  for (let row = 0; row < screen.rows; row += 1) {
    for (let col = 0; col < screen.columns; col += 1) {
      const cx = startX + col * screen.cell;
      const cy = startY + row * screen.cell;
      for (let i = 0; i < seg; i += 1) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        lines.push(
          cx + Math.cos(a0) * screen.radius, cy + Math.sin(a0) * screen.radius, z,
          cx + Math.cos(a1) * screen.radius, cy + Math.sin(a1) * screen.radius, z,
        );
      }
    }
  }
  return new Float32Array(lines);
}

export function buildMaskQuad(screen = SCREEN) {
  const w = screen.width / 2;
  const h = screen.height / 2;
  return new Float32Array([
    -w, -h, 0, w, -h, 0, w, h, 0,
    -w, -h, 0, w, h, 0, -w, h, 0,
  ]);
}
