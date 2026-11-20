// Convert a flattened (possibly dashed) polyline into a filled stroke outline.
// Joins: miter (with miter-limit clamp to bevel on the outer side), bevel, round.
// Caps: butt, round, square.
//
// The outline is built as two offset polylines. At every interior vertex the
// two adjacent offset edges are intersected, which yields the correct miter
// tip on both the outer and the inner side (the inner tip naturally points
// into the wedge). Miter-limit clamps only the outer edge to a bevel.

'use strict';

const { vsub, vadd, vscale, vlen, vnormal, vnorm } = require('./geometry');

function arcPoints(center, radius, startAngle, endAngle, segments) {
  const out = [];
  for (let i = 1; i <= segments; i += 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / segments;
    out.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return out;
}

function normalizeAngle(angle) {
  let result = angle;
  while (result <= -Math.PI) result += 2 * Math.PI;
  while (result > Math.PI) result -= 2 * Math.PI;
  return result;
}

// Intersection of two rays: p1 + t*d1 and p2 + u*d2. Returns null if parallel.
function rayIntersection(p1, d1, p2, d2) {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-12) return null;
  const delta = vsub(p2, p1);
  const t = (delta.x * d2.y - delta.y * d2.x) / cross;
  return vadd(p1, vscale(d1, t));
}

// Offset a single segment (p -> q) to one side. side=+1 left, -1 right.
function offsetSegment(p, q, side, halfWidth) {
  const tangent = vnorm(vsub(q, p));
  const normal = vnormal(tangent);
  const n = vscale(normal, side * halfWidth);
  return { start: vadd(p, n), end: vadd(q, n), tangent, normal };
}

// Round-join arc on the outer side, from offset point a to b around vertex.
// `turningLeft` selects the sweep direction so the arc follows the actual turn
// instead of always taking the positive (possibly long) way around.
function roundArc(vertex, a, b, halfWidth, turningLeft) {
  const startAngle = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const endAngle = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  let sweep = normalizeAngle(endAngle - startAngle);
  // The outer round join wraps around the outside of the wedge, which is the
  // reflex arc (>180deg). The short arc stays inside the wedge and would carve
  // into the stroke. Pick the sweep that turns away from the path interior.
  if (turningLeft) {
    if (sweep > 0) sweep -= 2 * Math.PI;
  } else if (sweep < 0) {
    sweep += 2 * Math.PI;
  }
  const segments = Math.max(5, Math.ceil(sweep * halfWidth / Math.max(0.35, halfWidth * 0.18)));
  return arcPoints(vertex, halfWidth, startAngle, startAngle + sweep, segments);
}

// Build one side offset polyline for an open or closed piece.
// side: +1 left, -1 right.
function buildSide(points, closed, side, style) {
  const halfWidth = style.width / 2;
  const miterLimit = style.miterLimit ?? 4;
  const join = style.lineJoin || 'miter';
  const count = points.length;
  const segmentCount = closed ? count : count - 1;

  // Per-segment offset data.
  const segments = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % count];
    segments.push(offsetSegment(p, q, side, halfWidth));
  }

  const result = [];
  const vertexIndices = closed ? count : count;
  for (let i = 0; i < vertexIndices; i += 1) {
    const isEnd = !closed && (i === 0 || i === count - 1);
    const vertex = points[i];
    // For open paths the incoming/outgoing segments at vertex i are simply
    // i-1 and i; only closed rings wrap around the segment array.
    const prevIndex = closed ? (i - 1 + segmentCount) % segmentCount : i - 1;
    const nextIndex = closed ? i % segmentCount : i;
    const prevSeg = segments[prevIndex];
    const nextSeg = segments[nextIndex];

    if (isEnd) {
      // End vertex: single offset point on this side.
      const seg = i === 0 ? nextSeg : prevSeg;
      result.push(vadd(vertex, vscale(seg.normal, side * halfWidth)));
      continue;
    }

    const a = prevSeg.end; // offset of this vertex along incoming edge
    const b = nextSeg.start; // offset along outgoing edge
    const cross = prevSeg.tangent.x * nextSeg.tangent.y
      - prevSeg.tangent.y * nextSeg.tangent.x;
    const turningLeft = cross > 0;
    // Outer side: left when turning left, right when turning right.
    const isOuter = (turningLeft && side === 1) || (!turningLeft && side === -1);

    if (Math.abs(cross) < 1e-12) {
      result.push(a);
      continue;
    }

    const intersection = rayIntersection(
      a,
      prevSeg.tangent,
      b,
      nextSeg.tangent,
    );

    // Miter ratio from the actual intersection distance.
    let miterRatio = 1;
    if (intersection) {
      miterRatio = vlen(vsub(intersection, vertex)) / halfWidth;
    }

    if (isOuter && join === 'round') {
      result.push(a);
      for (const arcPoint of roundArc(vertex, a, b, halfWidth, turningLeft)) result.push(arcPoint);
      continue;
    }

    if (!isOuter && join === 'round') {
      // Inner round join: the short arc stays inside the wedge. Its sweep is
      // opposite to the outer reflex arc.
      result.push(a);
      const innerTurningLeft = !turningLeft;
      for (const arcPoint of roundArc(vertex, a, b, halfWidth, innerTurningLeft)) {
        result.push(arcPoint);
      }
      continue;
    }

    if (intersection && (!isOuter || join === 'miter') && (join !== 'miter' || miterRatio <= miterLimit)) {
      result.push(intersection);
      continue;
    }

    // Bevel (or clamped miter): bridge a -> b on the outer side; the inner
    // side still uses the miter intersection when available.
    if (isOuter || !intersection) {
      result.push(a);
      result.push(b);
    } else {
      result.push(intersection);
    }
  }
  return result;
}

function buildCap(point, tangent, halfWidth, cap, isStart) {
  const normal = vnormal(tangent);
  if (cap === 'butt') {
    return [];
  }
  if (cap === 'square') {
    const direction = isStart ? -1 : 1;
    const shifted = vadd(point, vscale(tangent, direction * halfWidth));
    const lower = vadd(shifted, vscale(normal, halfWidth));
    const upper = vadd(shifted, vscale(normal, -halfWidth));
    // End cap closes lower->upper; start cap returns upper->lower.
    return isStart ? [upper, lower] : [lower, upper];
  }
  // Round cap: semicircle from the right side to the left side.
  const baseAngle = Math.atan2(normal.y, normal.x);
  // End cap sweeps lower->upper over the outward side; start cap sweeps
  // upper->lower on its outward side to close the ring without crossing.
  const startAngle = isStart ? baseAngle + Math.PI : baseAngle;
  const endAngle = isStart ? baseAngle : baseAngle - Math.PI;
  const segments = 14;
  return arcPoints(point, halfWidth, startAngle, endAngle, segments);
}

function strokePiece(piece, style) {
  const points = piece.points;
  const closed = piece.closed;
  const cap = style.lineCap || 'butt';

  if (points.length < 2) return [];

  const left = buildSide(points, closed, 1, style);
  const right = buildSide(points, closed, -1, style);

  if (closed) {
    // Emit the outer and inner offset polygons as two subpaths with opposite
    // windings. A single concatenated ring self-intersects at the corners and
    // rasterizes inconsistently; the two-subpath form is the standard
    // boundary-with-hole representation and fills correctly under the default
    // nonzero winding rule. The serializer joins subpaths with spaces.
    return [left, right.slice().reverse()];
  }

  const start = points[0];
  const end = points[points.length - 1];
  const tStart = vnorm(vsub(points[1], points[0]));
  const tEnd = vnorm(vsub(points[points.length - 1], points[points.length - 2]));
  const halfWidth = style.width / 2;

  // In screen coordinates (y down) the +normal "left" polyline is the lower
  // edge and the -normal "right" polyline is the upper edge. Build one simple
  // ring: lower edge start->end, end cap (lower->upper), upper edge end->start,
  // start cap (upper->lower). Each cap returns points ordered lower->upper.
  const lower = left;
  const upper = right;
  const endCap = buildCap(end, tEnd, halfWidth, cap, false);
  const startCap = buildCap(start, tStart, halfWidth, cap, true);
  return lower.concat(endCap, upper.slice().reverse(), startCap);
}

// Zero-length subpath stroke: a dot sized by the cap style.
function strokeZeroLength(point, style) {
  const halfWidth = style.width / 2;
  const cap = style.lineCap || 'butt';
  if (cap === 'butt') {
    // Browsers paint nothing for a zero-length butt-capped subpath.
    return [];
  }
  if (cap === 'square') {
    return [
      { x: point.x - halfWidth, y: point.y - halfWidth },
      { x: point.x + halfWidth, y: point.y - halfWidth },
      { x: point.x + halfWidth, y: point.y + halfWidth },
      { x: point.x - halfWidth, y: point.y + halfWidth },
    ];
  }
  const segments = 28;
  const circle = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (2 * Math.PI * i) / segments;
    circle.push({ x: point.x + halfWidth * Math.cos(angle), y: point.y + halfWidth * Math.sin(angle) });
  }
  return circle;
}

module.exports = { strokePiece, strokeZeroLength, buildCap, buildSide };
