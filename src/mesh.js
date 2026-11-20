// Mesh data structure and boundary-loop utilities.
// Mesh: { name, positions: [x,y,z,...], uvs: [u,v,...], faces: [i,j,k,...] }

function makeMesh(name, positions, uvs, faces) {
  return { name, positions, uvs, faces };
}

function vertexCount(mesh) {
  return mesh.positions.length / 3;
}

function getPoint(mesh, i) {
  return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
}

function getUV(mesh, i) {
  return [mesh.uvs[2 * i], mesh.uvs[2 * i + 1]];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length3(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) {
  const l = length3(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function faceNormal(mesh, f) {
  const a = getPoint(mesh, mesh.faces[3 * f]);
  const b = getPoint(mesh, mesh.faces[3 * f + 1]);
  const c = getPoint(mesh, mesh.faces[3 * f + 2]);
  return normalize(cross(sub(b, a), sub(c, a)));
}

// Extract closed boundary loops (edges used by exactly one triangle).
// Returns [{ vertices: [v0,v1,...] }] with winding consistent with the
// adjacent face orientation.
function extractBoundaryLoops(mesh) {
  const nF = mesh.faces.length / 3;
  const edgeAny = new Map();
  const edgeDir = new Set();
  for (let f = 0; f < nF; f++) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.faces[3 * f + e];
      const b = mesh.faces[3 * f + ((e + 1) % 3)];
      const key = a < b ? a + ',' + b : b + ',' + a;
      edgeAny.set(key, (edgeAny.get(key) || 0) + 1);
      edgeDir.add(a + ',' + b);
    }
  }
  const next = new Map();
  for (const key of edgeAny.keys()) {
    if (edgeAny.get(key) !== 1) continue;
    const parts = key.split(',');
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (edgeDir.has(a + ',' + b)) next.set(a, b);
    else next.set(b, a);
  }
  const loops = [];
  const visited = new Set();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const verts = [start];
    visited.add(start);
    let cur = next.get(start);
    while (cur !== undefined && cur !== start) {
      verts.push(cur);
      visited.add(cur);
      cur = next.get(cur);
    }
    if (cur === start && verts.length >= 3) loops.push({ vertices: verts });
  }
  return loops;
}

// Cumulative arc-length table for a closed loop.
function loopArcTable(mesh, loop) {
  const pts = loop.vertices.map((v) => getPoint(mesh, v));
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    cum.push(cum[i] + length3(sub(pts[(i + 1) % n], pts[i])));
  }
  return { pts, cum, total: cum[n] };
}

export {
  makeMesh, vertexCount, getPoint, getUV,
  sub, cross, dot, length3, normalize, faceNormal,
  extractBoundaryLoops, loopArcTable,
};
