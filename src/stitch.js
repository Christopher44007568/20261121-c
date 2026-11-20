// Non-uniform boundary stitching: re-segment two boundary loops by arc
// length using user-supplied anchor correspondences, then build a seam
// strip with paired samples on both sides (no unpaired vertices), UVs
// carried from the source meshes, and diagonal selection that avoids
// locally flipped faces.

import * as M from './mesh.js';

// Snap a 3D point to a boundary loop; returns arc parameter t in [0,1).
function snapToLoop(mesh, loop, point) {
  const tab = M.loopArcTable(mesh, loop);
  let best = { d2: Infinity, t: 0 };
  for (let i = 0; i < tab.pts.length; i++) {
    const a = tab.pts[i];
    const b = tab.pts[(i + 1) % tab.pts.length];
    const ab = M.sub(b, a);
    const len = M.length3(ab);
    if (len < 1e-12) continue;
    let s = M.dot(M.sub(point, a), ab) / (len * len);
    s = Math.max(0, Math.min(1, s));
    const p = [a[0] + ab[0] * s, a[1] + ab[1] * s, a[2] + ab[2] * s];
    const d2 = M.dot(M.sub(point, p), M.sub(point, p));
    if (d2 < best.d2) best = { d2, t: (tab.cum[i] + s * len) / tab.total };
  }
  return best.t;
}

// A loop view traversed in the opposite direction.
function reversedLoop(loop) {
  return { vertices: loop.vertices.slice().reverse() };
}

// Vertex arc parameters of a loop in its traversal order.
function loopVertexParams(mesh, loop) {
  const tab = M.loopArcTable(mesh, loop);
  const n = loop.vertices.length;
  const params = [];
  for (let i = 0; i < n; i++) params.push(tab.cum[i] / tab.total);
  return { params, total: tab.total, tab };
}

// Sample position + UV on a loop at arc parameter t (loop winding).
function sampleLoop(mesh, loop, tab, t) {
  const n = loop.vertices.length;
  const tMod = ((t % 1) + 1) % 1;
  const d = tMod * tab.total;
  let i = 0;
  while (i < n - 1 && tab.cum[i + 1] < d - 1e-12) i++;
  while (i < n - 1 && tab.cum[i + 1] <= d) i++;
  const segLen = tab.cum[i + 1] - tab.cum[i];
  const s = segLen > 1e-12 ? (d - tab.cum[i]) / segLen : 0;
  const va = loop.vertices[i];
  const vb = loop.vertices[(i + 1) % n];
  const pa = tab.pts[i];
  const pb = tab.pts[(i + 1) % n];
  const ua = M.getUV(mesh, va);
  const ub = M.getUV(mesh, vb);
  return {
    pos: [pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s],
    uv: [ua[0] + (ub[0] - ua[0]) * s, ua[1] + (ub[1] - ua[1]) * s],
    param: tMod,
    seg: i,
    segT: s,
  };
}

// Determine whether a parameter sequence runs cyclically increasing.
function cyclicDirection(ts) {
  let inc = 0;
  let dec = 0;
  for (let i = 0; i < ts.length; i++) {
    const d = (((ts[(i + 1) % ts.length] - ts[i]) % 1) + 1) % 1;
    if (d < 0.5) inc++;
    else dec++;
  }
  return inc >= dec ? 1 : -1;
}

// Average face normals into per-vertex normals.
function vertexNormals(mesh) {
  const n = M.vertexCount(mesh);
  const acc = new Array(n).fill(null).map(() => [0, 0, 0]);
  const nF = mesh.faces.length / 3;
  for (let f = 0; f < nF; f++) {
    const fn = M.faceNormal(mesh, f);
    for (let e = 0; e < 3; e++) {
      const v = mesh.faces[3 * f + e];
      acc[v][0] += fn[0]; acc[v][1] += fn[1]; acc[v][2] += fn[2];
    }
  }
  return acc.map(M.normalize);
}

function triNormal(a, b, c) {
  return M.normalize(M.cross(M.sub(b, a), M.sub(c, a)));
}

// Align loop directions and anchor params so both sides increase together.
// Anchors are sorted along loop A; if the B params run opposite, loop B is
// traversed in reverse. The pair list is rotated so the largest cyclic gap
// in ta is excluded (it is the unstitched rest of the loop); with
// closed=true a wrapped pair is appended so the seam covers the full ring.
function alignAnchors(meshA, loopA, meshB, loopB, anchors, closed) {
  const tabB0 = M.loopArcTable(meshB, loopB);
  let viewB = loopB;
  let pairs = anchors.map((an) => ({ ta: an.a, tb: an.b }));
  pairs.sort((x, y) => x.ta - y.ta);
  // does tb decrease as ta increases?
  let dec = 0;
  let inc = 0;
  for (let i = 1; i < pairs.length; i++) {
    const d = pairs[i].tb - pairs[i - 1].tb;
    if (d > 0) inc++;
    else if (d < 0) dec++;
  }
  if (dec > inc) {
    viewB = reversedLoop(loopB);
    pairs = anchors.map((an) => {
      const pb = sampleLoop(meshB, loopB, tabB0, an.b).pos;
      return { ta: an.a, tb: snapToLoop(meshB, viewB, pb) };
    });
    pairs.sort((x, y) => x.ta - y.ta);
  }
  // rotate so the largest cyclic ta gap sits after the last pair
  let k0 = 0;
  let gap0 = -1;
  for (let i = 0; i < pairs.length; i++) {
    const next = pairs[(i + 1) % pairs.length].ta;
    const gap = (((next - pairs[i].ta) % 1) + 1) % 1;
    if (gap > gap0) {
      gap0 = gap;
      k0 = i + 1;
    }
  }
  const out = [];
  for (let i = 0; i < pairs.length; i++) out.push(pairs[(k0 + i) % pairs.length]);
  // unwrap both sides to be strictly increasing
  for (let i = 1; i < out.length; i++) {
    let ta = out[i].ta;
    let tb = out[i].tb;
    while (ta <= out[i - 1].ta) ta += 1;
    while (tb <= out[i - 1].tb) tb += 1;
    out[i] = { ta, tb };
  }
  if (closed) out.push({ ta: out[0].ta + 1, tb: out[0].tb + 1 });
  return { viewA: loopA, viewB, pairs: out };
}

// Union of normalized interior vertex parameters from both sides, so every
// original boundary vertex gets a paired sample on the opposite side.
function intervalSamples(paramsA, t0, t1, paramsB, u0, u1) {
  const set = new Set([0, 1]);
  const spanA = t1 - t0;
  const spanB = u1 - u0;
  for (const p of paramsA) {
    const rel = (((p - t0) % 1) + 1) % 1;
    if (rel > 1e-9 && rel < spanA - 1e-9) set.add(rel / spanA);
  }
  for (const p of paramsB) {
    const rel = (((p - u0) % 1) + 1) % 1;
    if (rel > 1e-9 && rel < spanB - 1e-9) set.add(rel / spanB);
  }
  const arr = Array.from(set).sort((x, y) => x - y);
  const dedup = [];
  for (const s of arr) {
    if (!dedup.length || s - dedup[dedup.length - 1] > 1e-7) dedup.push(s);
  }
  if (1 - dedup[dedup.length - 1] <= 1e-7) dedup[dedup.length - 1] = 1;
  return dedup;
}

// Main entry. anchors: [{a, b}] arc params on the original loops, listed in
// correspondence order around the seam. Returns the merged preview mesh:
// { positions, uvs, boundaryIds, faces, groups, debug }.
// opts.closed: stitch the whole loop ring (default false = only the arc
// covered by the anchors, excluding the largest anchor gap).
function stitch(meshA, loopA, meshB, loopB, anchors, opts) {
  const closed = !!(opts && opts.closed);
  if (anchors.length < 2) throw new Error('need at least 2 anchor pairs');
  const { viewA, viewB, pairs: ord } = alignAnchors(meshA, loopA, meshB, loopB, anchors, closed);
  const tabA = M.loopArcTable(meshA, viewA);
  const tabB = M.loopArcTable(meshB, viewB);
  const vparamsA = loopVertexParams(meshA, viewA).params;
  const vparamsB = loopVertexParams(meshB, viewB).params;
  const nrmA = vertexNormals(meshA);
  const nrmB = vertexNormals(meshB);

  // Build the sample strip (ring when closed).
  const sampA = [];
  const sampB = [];
  const intervals = [];
  for (let k = 0; k + 1 < ord.length; k++) {
    const { ta: t0, tb: u0 } = ord[k];
    const { ta: t1, tb: u1 } = ord[k + 1];
    const S = intervalSamples(vparamsA, t0, t1, vparamsB, u0, u1);
    intervals.push(S.length - 1);
    for (let idx = 0; idx < S.length; idx++) {
      if (k > 0 && idx === 0) continue; // shared with previous interval
      const s = S[idx];
      const sa = sampleLoop(meshA, viewA, tabA, t0 + s * (t1 - t0));
      const sb = sampleLoop(meshB, viewB, tabB, u0 + s * (u1 - u0));
      sa.nrm = interpNormal(nrmA, viewA, sa);
      sb.nrm = interpNormal(nrmB, viewB, sb);
      sampA.push(sa);
      sampB.push(sb);
    }
  }
  const m = sampA.length;
  const quadCount = closed ? m : m - 1;

  // Assemble output arrays.
  const nA = M.vertexCount(meshA);
  const nB = M.vertexCount(meshB);
  const positions = meshA.positions.concat(meshB.positions);
  const uvs = meshA.uvs.concat(meshB.uvs);
  const boundaryIds = new Array(nA + nB).fill(0);
  for (const v of loopA.vertices) boundaryIds[v] = 1;
  for (const v of loopB.vertices) boundaryIds[nA + v] = 2;
  const stripBase = nA + nB;
  for (let i = 0; i < m; i++) {
    positions.push(...sampA[i].pos);
    uvs.push(...sampA[i].uv);
    boundaryIds.push(1);
  }
  for (let i = 0; i < m; i++) {
    positions.push(...sampB[i].pos);
    uvs.push(...sampB[i].uv);
    boundaryIds.push(2);
  }

  const faces = meshA.faces.concat(meshB.faces.map((v) => v + nA));
  const groups = [
    { name: meshA.name || 'pieceA', start: 0, count: meshA.faces.length },
    { name: meshB.name || 'pieceB', start: meshA.faces.length, count: meshB.faces.length },
    { name: 'seam', start: meshA.faces.length + meshB.faces.length, count: 0 },
  ];
  const seamStart = faces.length;
  const quadRefs = [];
  const seamFaceQuad = [];
  for (let i = 0; i < quadCount; i++) {
    const j = (i + 1) % m;
    const ai = stripBase + i;
    const aj = stripBase + j;
    const bi = stripBase + m + i;
    const bj = stripBase + m + j;
    const ref = quadRefNormal(sampA[i].nrm, sampA[j].nrm, sampB[i].nrm, sampB[j].nrm);
    quadRefs.push(ref);
    const tris = buildQuad(
      [sampA[i].pos, sampA[j].pos, sampB[j].pos, sampB[i].pos],
      [ai, aj, bj, bi],
      ref
    );
    for (const t of tris) {
      faces.push(...t);
      seamFaceQuad.push(i);
    }
  }
  groups[2].count = faces.length - seamStart;

  return {
    positions, uvs, boundaryIds, faces, groups,
    debug: {
      closed,
      sampleCount: m,
      intervals,
      spanA: [ord[0].ta, ord[ord.length - 1].ta],
      spanB: [ord[0].tb, ord[ord.length - 1].tb],
      vertexParamsA: vparamsA,
      vertexParamsB: vparamsB,
      sampleParamsA: sampA.map((s) => s.param),
      sampleParamsB: sampB.map((s) => s.param),
      quadRefs,
      seamFaceQuad,
    },
  };
}

function interpNormal(nrms, view, sample) {
  const n = view.vertices.length;
  const va = view.vertices[sample.seg];
  const vb = view.vertices[(sample.seg + 1) % n];
  const s = sample.segT;
  return M.normalize([
    nrms[va][0] * (1 - s) + nrms[vb][0] * s,
    nrms[va][1] * (1 - s) + nrms[vb][1] * s,
    nrms[va][2] * (1 - s) + nrms[vb][2] * s,
  ]);
}

function quadRefNormal(na0, na1, nb0, nb1) {
  const sumA = [na0[0] + na1[0], na0[1] + na1[1], na0[2] + na1[2]];
  const sumB = [nb0[0] + nb1[0], nb0[1] + nb1[1], nb0[2] + nb1[2]];
  let ref = sumA;
  if (M.dot(sumA, sumB) >= 0) ref = [sumA[0] + sumB[0], sumA[1] + sumB[1], sumA[2] + sumB[2]];
  return M.normalize(ref);
}

// Triangulate quad (p0,p1,p2,p3) with indices (i0,i1,i2,i3). Picks the
// diagonal whose triangles best face the reference normal, then orients
// each triangle toward the reference normal individually, so bowtie
// quads (e.g. near concave notches) never emit a locally flipped face.
function buildQuad(p, idx, ref) {
  const score = (t1, t2) => {
    const n1 = M.cross(M.sub(p[t1[1]], p[t1[0]]), M.sub(p[t1[2]], p[t1[0]]));
    const n2 = M.cross(M.sub(p[t2[1]], p[t2[0]]), M.sub(p[t2[2]], p[t2[0]]));
    const l1 = M.length3(n1);
    const l2 = M.length3(n2);
    let s = 0;
    s += l1 > 1e-10 ? M.dot(n1, ref) / l1 : -2;
    s += l2 > 1e-10 ? M.dot(n2, ref) / l2 : -2;
    return s;
  };
  // diagonal p0-p2
  const d1 = [[0, 1, 2], [0, 2, 3]];
  // diagonal p1-p3
  const d2 = [[0, 1, 3], [1, 2, 3]];
  const best = score(d1[0], d1[1]) >= score(d2[0], d2[1]) ? d1 : d2;
  const out = [];
  for (const t of best) {
    let tri = t;
    const a = p[tri[0]];
    const b = p[tri[1]];
    const c = p[tri[2]];
    const n = M.cross(M.sub(b, a), M.sub(c, a));
    if (M.length3(n) < 1e-10) continue; // skip degenerate
    if (M.dot(n, ref) < 0) tri = [t[0], t[2], t[1]];
    out.push([idx[tri[0]], idx[tri[1]], idx[tri[2]]]);
  }
  return out;
}

export {
  snapToLoop, reversedLoop, loopVertexParams, sampleLoop, cyclicDirection,
  vertexNormals, triNormal, alignAnchors, intervalSamples, stitch,
};
