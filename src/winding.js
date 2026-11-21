// Exact winding-number evaluation on the arrangement and boolean edge
// selection. Every atomic edge has a clean face on each side, so a symbolic
// epsilon probe yields exact, robust winding numbers (no floating fuzz).

import { Q } from "./rational.js";
import { pointKey } from "./arrangement.js";
import { orient } from "./geometry-int.js";

const ZERO = new Q(0n);

export function computeFaceWinding(edges, sourceSegments, rule = "nonzero") {
  for (const edge of edges) {
    const probe = leftProbe(edge, sourceSegments);
    const wLeft = windingBySet(probe, sourceSegments, rule);

    const jump = {};
    for (const src of edge.sources) {
      jump[src.setId] = (jump[src.setId] ?? 0) + src.sign;
    }
    const wRight = {};
    for (const [setId, w] of Object.entries(wLeft)) {
      wRight[setId] = w - (jump[setId] ?? 0);
    }
    edge.wLeft = wLeft;
    edge.wRight = wRight;
    edge.jump = jump;
  }
  return edges;
}

// Pick p = midpoint + epsilon * (-dy, dx) / len, with epsilon strictly smaller
// than every positive vertex distance to the supporting line. This keeps the
// probe inside the left-hand face without ever landing on another edge.
function leftProbe(edge, sourceSegments) {
  const dx = edge.b.x.sub(edge.a.x);
  const dy = edge.b.y.sub(edge.a.y);
  const len2 = dx.mul(dx).add(dy.mul(dy));
  const mx = edge.a.x.add(edge.b.x).mul(new Q(1n, 2n));
  const my = edge.a.y.add(edge.b.y).mul(new Q(1n, 2n));

  let eps = new Q(1n, 2n);
  for (const seg of sourceSegments) {
    for (const p of [seg.a, seg.b]) {
      const cross = dx.mul(p.y.sub(edge.a.y)).sub(dy.mul(p.x.sub(edge.a.x)));
      if (cross.isZero()) continue;
      // Line distance = |cross|/sqrt(len2), offset magnitude = eps*sqrt(len2);
      // equal when eps = |cross|/len2 (the Q quotient below keeps it exact).
      // Keep the strict minimum so the probe never reaches another edge.
      const absCross = cross.n < 0n ? cross.neg() : cross;
      // Q quotient |cross| / len2, kept exact; eps scales the unit normal.
      const candidate = new Q(
        absCross.n * len2.d,
        absCross.d * len2.n,
      );
      if (candidate.cmp(eps) < 0) eps = candidate;
    }
  }
  eps = eps.mul(new Q(1n, 2n));

  return {
    x: mx.add(eps.mul(dy.neg())),
    y: my.add(eps.mul(dx)),
  };
}

function windingBySet(point, sourceSegments, rule) {
  const result = {};
  for (const seg of sourceSegments) {
    const w = result[seg.setId] ?? 0;
    result[seg.setId] = w + pointWindingContribution(point, seg);
  }
  if (rule === "evenodd") {
    for (const id of Object.keys(result)) result[id] = Math.abs(result[id]) % 2;
  }
  return result;
}

// Standard +1/-1 ray-cast winding number with a +x horizontal ray and
// half-open edge convention, evaluated on exact rationals.
function pointWindingContribution(p, seg) {
  const { a, b } = seg;
  const ay = a.y.cmp(p.y);
  const by = b.y.cmp(p.y);
  // Standard winding number on a +x ray. Upward crossing on the ray adds +1
  // (p strictly right of the edge, orient>0); downward crossing adds -1.
  if (ay <= 0 && by > 0 && orient(a, b, p) > 0) return 1;
  if (ay > 0 && by <= 0 && orient(a, b, p) < 0) return -1;
  return 0;
}

export function pointWinding(point, rings) {
  let w = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      w += pointWindingContribution(point, { a, b });
    }
  }
  return w;
}

export function selectBoundaryEdges(edges, operation, setIds, rule = "nonzero") {
  const inside = (w) => (rule === "evenodd" ? (w % 2 !== 0 ? 1 : 0) : (w === 0 ? 0 : 1));
  const keep = [];

  for (const edge of edges) {
    const left = setIds.map((id) => inside(edge.wLeft[id] ?? 0));
    const right = setIds.map((id) => inside(edge.wRight[id] ?? 0));
    let inL;
    let inR;
    if (operation === "union") {
      inL = left.some(Boolean);
      inR = right.some(Boolean);
    } else if (operation === "intersection") {
      inL = left.every(Boolean);
      inR = right.every(Boolean);
    } else if (operation === "difference") {
      inL = left[0] === 1 && left.slice(1).every((v) => v === 0);
      inR = right[0] === 1 && right.slice(1).every((v) => v === 0);
    } else if (operation === "xor") {
      inL = left.filter(Boolean).length % 2 === 1;
      inR = right.filter(Boolean).length % 2 === 1;
    } else {
      throw new Error(`unknown operation: ${operation}`);
    }
    if (inL === inR) continue;
    keep.push({ edge, direction: inL ? 1 : -1 });
  }
  return keep;
}

// Assemble oriented boundary edges into closed loops by angle-ordered pairing
// at every vertex, which stays well-defined at tangent/pinch vertices.
export function assembleLoops(boundary) {
  const outgoing = new Map();
  const directed = boundary.map(({ edge, direction }) => {
    const a = direction === 1 ? edge.a : edge.b;
    const b = direction === 1 ? edge.b : edge.a;
    return { a, b, used: false, edge };
  });

  for (const h of directed) {
    const key = pointKey(h.a);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(h);
  }

  const loops = [];
  for (const start of directed) {
    if (start.used) continue;
    const loop = [];
    let current = start;
    do {
      current.used = true;
      loop.push(current.a);
      const candidates = outgoing.get(pointKey(current.b));
      current = pairNext(current, candidates);
      if (!current) break;
    } while (current !== start);
    loops.push(loop);
  }
  return loops;
}

function pairNext(incoming, candidates) {
  // Face-cycle rule for a planar subdivision: at the shared vertex, list all
  // outgoing rays in CCW angle order and follow the ray immediately clockwise
  // of the reverse-incoming ray. That keeps the same face on the left of the
  // walk and correctly separates loops that meet only at a pinch vertex.
  const dx = incoming.b.x.sub(incoming.a.x);
  const dy = incoming.b.y.sub(incoming.a.y);
  const rays = candidates
    .filter((h) => !h.used)
    .map((h) => ({
      h,
      vx: h.b.x.sub(h.a.x),
      vy: h.b.y.sub(h.a.y),
    }));
  const incomingRay = { vx: dx.neg(), vy: dy.neg() };
  const sorted = rays.slice().sort((r1, r2) => ccwCompare(r1, r2));
  const same = rays.find((r) => sameRay(r, incomingRay));
  if (same) return same.h;
  if (!sorted.length) return null;
  // Standard half-edge face walk: take the outgoing ray immediately clockwise
  // (the CCW-order predecessor) of the reverse-incoming ray. That keeps the
  // same face on the left and closes each face independently even where two
  // regions meet only at a tangent or pinch vertex.
  let index = 0;
  while (index < sorted.length && ccwCompare(sorted[index], incomingRay) <= 0) index++;
  const pick = sorted[(index - 1 + sorted.length) % sorted.length];
  return pick.h;
}

function half(v) {
  // Standard atan2 half-plane split: upper half (y>0, or y==0 with x>0) is
  // sector 0, lower half is sector 1. This makes the CCW ordering continuous
  // across the +/-x axes so predecessor lookup is a true circular order.
  const upper = v.vy.cmp(ZERO) > 0 || (v.vy.isZero() && v.vx.cmp(ZERO) >= 0);
  return upper ? 0 : 1;
}

function ccwCompare(r1, r2) {
  const h1 = half(r1);
  const h2 = half(r2);
  if (h1 !== h2) return h1 - h2;
  const cross = r1.vx.mul(r2.vy).sub(r1.vy.mul(r2.vx));
  // cross>0 means r2 is CCW of r1, so r1 sorts first and the comparator
  // returns negative; collinear rays compare equal for ordering purposes.
  return cross.neg().cmp(ZERO);
}

function sameRay(r1, r2) {
  return (
    r1.vx.mul(r2.vy).sub(r1.vy.mul(r2.vx)).isZero() &&
    r1.vx.mul(r2.vx).add(r1.vy.mul(r2.vy)).cmp(ZERO) > 0
  );
}
