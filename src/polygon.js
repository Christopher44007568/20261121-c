// Turn raw loops into triangulable polygons (outer CCW + holes CW), classify
// degenerate geometry, and verify triangulability with an exact ear clipper.

import { Q } from "./rational.js";
import { orient, pointOnSegment } from "./geometry-int.js";
import { pointKey } from "./arrangement.js";

const ZERO = new Q(0n);

export function signedArea2(ring) {
  let area = ZERO;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area = area.add(a.x.mul(b.y).sub(a.y.mul(b.x)));
  }
  return area;
}

// Remove collinear arrangement-split vertices from an output ring while
// preserving its shape, orientation and exact area.
export function simplifyRing(ring) {
  const out = ring.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      if (orient(prev, cur, next) === 0 && pointOnSegment(cur, prev, next)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function classifyLoops(loops, diag) {
  const outer = [];
  const inner = [];
  for (const [index, loop] of loops.entries()) {
    const area2 = signedArea2(loop);
    if (area2.isZero()) {
      diag.warn("W_DEGENERATE_RING", { ring: index, distinctVertices: loop.length });
      continue;
    }
    if (area2.n > 0n) outer.push({ ring: loop, area2, index });
    else inner.push({ ring: loop, area2: area2.neg(), index });
  }

  const polygons = outer.map((o) => ({ outer: o.ring, holes: [], area2: o.area2 }));
  for (const hole of inner) {
    const host = polygons
      .filter((p) => ringContainsPoint(p.outer, hole.ring[0]))
      .sort((p1, p2) => p1.area2.cmp(p2.area2))[0];
    if (!host) {
      diag.warn("W_ORPHAN_HOLE", { ring: hole.index });
      continue;
    }
    host.holes.push(hole.ring);
    host.area2 = host.area2.sub(hole.area2);
  }
  return polygons;
}

export function ringContainsPoint(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const aboveA = a.y.cmp(p.y) > 0;
    const aboveB = b.y.cmp(p.y) > 0;
    if (aboveA === aboveB) continue;
    // x = ax + (bx-ax) * (py-ay)/(by-ay); compare with px exactly.
    const lhs = p.x.sub(a.x).mul(b.y.sub(a.y));
    const rhs = b.x.sub(a.x).mul(p.y.sub(a.y));
    const crossing = lhs.cmp(rhs);
    if (aboveB ? crossing < 0 : crossing > 0) inside = !inside;
  }
  return inside;
}

// Edges that carry no area on either side after merging (e.g. shared edges
// that cancel), collinear splits, and zero-length remnants.
export function classifyDegenerateEdges(mergedEdges, boundaryKeys) {
  const degenerate = [];
  for (const edge of mergedEdges) {
    const tags = [];
    if (edge.a.x.equals(edge.b.x) && edge.a.y.equals(edge.b.y)) tags.push("zero-length");
    const setIds = new Set(edge.sources.map((s) => s.setId));
    if (setIds.size > 1) tags.push("shared");
    // A shared edge cancels when contributing sets traverse it in opposite
    // geometric directions, so the boundary contributions negate each other.
    const directions = new Set(edge.sources.map((s) => s.direction));
    if (setIds.size > 1 && directions.size > 1) tags.push("cancelled");
    if (!boundaryKeys.has(edge.key)) tags.push("interior");
    if (tags.length) {
      degenerate.push({
        a: qPoint(edge.a),
        b: qPoint(edge.b),
        tags,
      });
    }
  }
  return degenerate;
}

function qPoint(p) {
  return { x: p.x, y: p.y, key: pointKey(p) };
}

// ---- Exact ear-clipping triangulation check --------------------------------

export function verifyTriangulable(polygon, diag, polygonIndex) {
  const flat = bridgeHoles(polygon);
  const triangles = earClip(flat);
  if (!triangles) {
    diag.error("E_TRIVIAL_INPUT", { polygon: polygonIndex, reason: "ear clipping failed" });
    return { ok: false, triangles: [] };
  }
  const triArea = triangles.reduce(
    (sum, t) => {
      const a = signedArea2([t[0], t[1], t[2]]);
      return sum.add(a.n < 0n ? a.neg() : a);
    },
    ZERO,
  );
  const expected = polygon.area2;
  const ok = triArea.equals(expected);
  if (!ok) {
    diag.warn("W_AREA_MISMATCH", {
      polygon: polygonIndex,
      expected: expected.toString(),
      triangulated: triArea.toString(),
    });
  }
  return { ok, triangles: triangles.map((t) => t.map(qPoint)) };
}

function bridgeHoles(polygon) {
  // Merge each CW hole into the outer CCW ring with a mutator bridge whose two
  // endpoints are distinct, mutually visible points. The result is a genuinely
  // simple CCW polygon, so ordinary ear clipping triangulates it directly.
  let ring = polygon.outer.slice();
  for (const hole of polygon.holes) {
    let holeIndex = 0;
    for (let i = 1; i < hole.length; i++) {
      if (hole[i].x.cmp(hole[holeIndex].x) < 0) holeIndex = i;
    }
    const holeStart = hole[holeIndex];
    const hit = leftRayHit(ring, holeStart);
    const bridgeIndex = insertPoint(ring, hit.edgeIndex, hit.point);
    const anchor = ring[bridgeIndex];
    // Traverse the stored CW hole starting at its bridge vertex.
    const holeCW = hole.slice(holeIndex).concat(hole.slice(0, holeIndex));
    const next = ring.slice(bridgeIndex + 1);
    ring = ring
      .slice(0, bridgeIndex + 1)
      .concat([holeStart], holeCW.slice(1), [holeStart], [anchor], next);
    ring = dedupeConsecutive(ring);
  }
  return ring;
}

function leftRayHit(ring, from) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a.y.equals(from.y) || !b.y.equals(from.y)) continue;
    if (a.x.cmp(from.x) >= 0) continue;
    const candidate = a.x.cmp(b.x) > 0 ? a : b;
    if (!best || candidate.x.cmp(best.point.x) > 0) {
      best = { edgeIndex: i, point: candidate };
    }
  }
  if (best) return best;
  // General (slanted) edge: solve for the horizontal-line intersection.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const spans = (a.y.cmp(from.y) <= 0 && b.y.cmp(from.y) > 0)
      || (b.y.cmp(from.y) <= 0 && a.y.cmp(from.y) > 0);
    if (!spans) continue;
    const t = from.y.sub(a.y).mul(new Q(b.y.sub(a.y).d, b.y.sub(a.y).n));
    const px = a.x.add(b.x.sub(a.x).mul(t));
    if (px.cmp(from.x) >= 0) continue;
    if (!best || px.cmp(best.point.x) > 0) best = { edgeIndex: i, point: { x: px, y: from.y } };
  }
  if (!best) throw new Error("bridgeHoles: no outer-boundary intersection for hole");
  return best;
}

function insertPoint(ring, edgeIndex, point) {
  const a = ring[edgeIndex];
  const b = ring[(edgeIndex + 1) % ring.length];
  if (pointKey(a) === pointKey(point)) return edgeIndex;
  if (pointKey(b) === pointKey(point)) return (edgeIndex + 1) % ring.length;
  ring.splice(edgeIndex + 1, 0, point);
  return edgeIndex + 1;
}

function dedupeConsecutive(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || pointKey(last) !== pointKey(p)) out.push(p);
  }
  if (out.length > 1 && pointKey(out[0]) === pointKey(out[out.length - 1])) out.pop();
  return out;
}

function earClip(ringIn) {
  const initial = ringIn.slice();
  const bridgeKeys = new Set();
  const initialCounts = new Map();
  for (const p of initial) {
    const key = pointKey(p);
    initialCounts.set(key, (initialCounts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of initialCounts) if (n > 1) bridgeKeys.add(key);
  const ring = removeCollinear(removeSpikes(initial));
  const duplicateKeys = new Set();
  const counts = new Map();
  for (const p of ring) counts.set(pointKey(p), (counts.get(pointKey(p)) ?? 0) + 1);
  for (const [key, n] of counts) if (n > 1) duplicateKeys.add(key);
  for (const key of bridgeKeys) duplicateKeys.add(key);
  if (ring.length < 3 || signedArea2(ring).n <= 0n) return null;
  const triangles = [];
  let guard = ring.length * ring.length + 8;
  while (ring.length > 3 && guard-- > 0) {
    const ear = findEar(ring, duplicateKeys);
    if (ear < 0) return null;
    triangles.push([ring[(ear - 1 + ring.length) % ring.length], ring[ear], ring[(ear + 1) % ring.length]]);
    ring.splice(ear, 1);
  }
  if (ring.length !== 3) return null;
  triangles.push([ring[0], ring[1], ring[2]]);
  return triangles;
}

// Drop vertices lying on the straight line between their two neighbours; they
// are arrangement split points that add no shape and stall ear selection.
function removeCollinear(ring) {
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const cur = ring[i];
      const next = ring[(i + 1) % ring.length];
      if (orient(prev, cur, next) === 0 && pointOnSegment(cur, prev, next)) {
        ring.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

// Zero-width bridges leave a weakly-simple ring and arrangement splits leave
// collinear points. Only remove local zero-area spikes (prev === next); the
// non-adjacent bridge duplicates are handled as edge-on points during ear
// clipping rather than deleted, which would corrupt the polygon area.
function removeSpikes(ring) {
  let changed = true;
  while (changed && ring.length >= 4) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const next = ring[(i + 1) % ring.length];
      if (pointKey(prev) === pointKey(next)) {
        ring.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

function findEar(ring, bridgeKeys) {
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const cur = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (orient(prev, cur, next) <= 0) continue;
    let clean = true;
    for (let j = 0; j < ring.length; j++) {
      if (j === i || j === (i - 1 + ring.length) % ring.length || j === (i + 1) % ring.length) continue;
      const candidate = ring[j];
      // Bridge tips coincide geometrically and carry no area; ignore them.
      if (bridgeKeys && bridgeKeys.has(pointKey(candidate))) continue;
      if (pointInTriangle(candidate, prev, cur, next)) {
        clean = false;
        break;
      }
    }
    if (clean) return i;
  }
  return -1;
}

function pointInTriangle(p, a, b, c) {
  const o1 = orient(a, b, p);
  const o2 = orient(b, c, p);
  const o3 = orient(c, a, p);
  const hasNeg = o1 < 0 || o2 < 0 || o3 < 0;
  const hasPos = o1 > 0 || o2 > 0 || o3 > 0;
  if (hasNeg && hasPos) return false;
  return pointOnSegment(p, a, b) || pointOnSegment(p, b, c) || pointOnSegment(p, c, a)
    || (o1 >= 0 && o2 >= 0 && o3 >= 0);
}
