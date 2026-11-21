// Exact integer/rational planar geometry primitives.

import { Q } from "./rational.js";

export function iPoint(x, y) {
  return { x: new Q(BigInt(x)), y: new Q(BigInt(y)) };
}

export function orient(a, b, c) {
  // >0: c left of a->b (CCW), 0: collinear, <0: right
  const v = (b.x.sub(a.x)).mul(c.y.sub(a.y)).sub(
    (b.y.sub(a.y)).mul(c.x.sub(a.x)),
  );
  return v.isZero() ? 0 : v.n > 0n ? 1 : -1;
}

function onBoundingBox(p, a, b) {
  const minX = a.x.cmp(b.x) <= 0 ? a.x : b.x;
  const maxX = a.x.cmp(b.x) >= 0 ? a.x : b.x;
  const minY = a.y.cmp(b.y) <= 0 ? a.y : b.y;
  const maxY = a.y.cmp(b.y) >= 0 ? a.y : b.y;
  return (
    p.x.cmp(minX) >= 0 && p.x.cmp(maxX) <= 0 &&
    p.y.cmp(minY) >= 0 && p.y.cmp(maxY) <= 0
  );
}

export function pointOnSegment(p, a, b) {
  return orient(a, b, p) === 0 && onBoundingBox(p, a, b);
}

// Intersection between two rational segments.
// Returns { proper: bool, points: [rationalPoint, ...] }.
// A proper crossing yields one interior point; collinear overlap yields the
// up-to-two overlap endpoints (may be a single touch point).
export function segmentIntersection(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 !== o2 && o1 !== 0 && o2 !== 0) {
    return { proper: true, points: [crossingPoint(a, b, c, d)] };
  }

  // Collinear / T-junction / endpoint touch: test every endpoint against the
  // opposite segment's interior-inclusive range.
  const touch = [];
  if (o1 === 0 && onBoundingBox(c, a, b)) touch.push(c);
  if (o2 === 0 && onBoundingBox(d, a, b)) touch.push(d);
  if (o3 === 0 && onBoundingBox(a, c, d)) touch.push(a);
  if (o4 === 0 && onBoundingBox(b, c, d)) touch.push(b);
  if (touch.length) {
    return { proper: false, points: dedupePoints(touch) };
  }
  return { proper: false, points: [] };
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    if (!out.some((q) => q.x.equals(p.x) && q.y.equals(p.y))) out.push(p);
  }
  return out;
}

function crossingPoint(a, b, c, d) {
  // Solve a + t(b-a) = c + s(d-c) using rational cross products.
  const rx = b.x.sub(a.x);
  const ry = b.y.sub(a.y);
  const sx = d.x.sub(c.x);
  const sy = d.y.sub(c.y);
  const denom = rx.mul(sy).sub(ry.mul(sx)); // r x s, non-zero here
  const cax = c.x.sub(a.x);
  const cay = c.y.sub(a.y);
  const num = cax.mul(sy).sub(cay.mul(sx));
  const tq = new Q(num.n * denom.d, num.d * denom.n);
  return {
    x: a.x.add(rx.mul(tq)),
    y: a.y.add(ry.mul(tq)),
  };
}

// 0..1 rational parameter of p on segment a->b; p is assumed collinear.
export function segmentParam(p, a, b) {
  const dx = b.x.sub(a.x);
  const dy = b.y.sub(a.y);
  const axis = dx.isZero() ? p.y.sub(a.y) : p.x.sub(a.x);
  const span = dx.isZero() ? dy : dx;
  return new Q(axis.n * span.d, axis.d * span.n);
}

export function pointsEqual(p, q) {
  return p.x.equals(q.x) && p.y.equals(q.y);
}
