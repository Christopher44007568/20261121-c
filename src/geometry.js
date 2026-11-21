// Core 2D geometry: outline structures, Bezier flattening, winding rules,
// point-to-segment distance. All coordinates live in the glyph's own EM space.

export const WINDING = { NONZERO: 'nonzero', EVENODD: 'evenodd' };

export function vec(x, y) {
  return { x, y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Squared distance from point p to segment a-b.
export function pointSegmentDistance2(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return dx * dx + dy * dy;
}

// Edge-local signed distance following msdfgen's LinearSegment rule.
// Distance convention: NEGATIVE inside (left of a correctly directed edge),
// matching msdfgen so the median reconstruction behaves identically.
//   * projection inside the segment -> orthogonal distance, sign from the
//     edge's inward normal;
//   * projection outside -> endpoint distance with the cross-product sign,
//     which keeps corner-adjacent texels on the correct side.
export function edgeSignedDistance(p, a, b) {
  const ab = sub(b, a);
  const aq = sub(p, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  let t = len2 > 0 ? (aq.x * ab.x + aq.y * ab.y) / len2 : 0;
  if (t > 0 && t < 1) {
    // msdfgen orthonormal(false) = (ab.y, -ab.x)/|ab|; for a CCW edge this
    // points inward, so its dot with aq is negative on the inner side.
    const ortho = ab.y * aq.x - ab.x * aq.y;
    const len = Math.sqrt(len2);
    return ortho / len;
  }
  const endpointDistance = Math.sqrt(pointSegmentDistance2(p, a, b));
  const c = aq.x * ab.y - aq.y * ab.x;
  return (c >= 0 ? 1 : -1) * endpointDistance;
}

// Perpendicular selector modeled on msdfgen's
// PerpendicularDistanceSelector. We track the nearest edge by true distance
// but also the closest positive and negative perpendicular (extended-line)
// distances. The returned value uses the extended line when the projection
// falls outside the segment, which is essential around corners and, crucially,
// keeps narrow counters (holes) on the correct side of every channel.
export function perpendicularChannelDistance(p, segments, maskBit, fallback) {
  let trueDistance = 0;
  let minNeg = 0;
  let minPos = 0;
  let nearSeg = null;
  let saw = false;

  for (const seg of segments) {
    if (!(seg.mask & maskBit)) continue;
    const d = edgeSignedDistance(p, seg.a, seg.b);
    if (!saw || Math.abs(d) < Math.abs(trueDistance)) {
      trueDistance = d;
      nearSeg = seg;
    }
    // Perpendicular distance to the infinite supporting line.
    const ab = sub(seg.b, seg.a);
    const aq = sub(p, seg.a);
    const len = Math.hypot(ab.x, ab.y) || 1;
    const perp = (ab.y * aq.x - ab.x * aq.y) / len;
    if (!saw) {
      minNeg = perp <= 0 ? perp : Infinity;
      minPos = perp >= 0 ? perp : -Infinity;
    } else {
      if (perp <= 0 && perp > minNeg) minNeg = perp;
      if (perp >= 0 && perp < minPos) minPos = perp;
    }
    saw = true;
  }
  if (!saw) return fallback;

  let result = trueDistance < 0 ? minNeg : minPos;
  if (nearSeg) {
    const td = edgeSignedDistance(p, nearSeg.a, nearSeg.b);
    if (Math.abs(td) < Math.abs(result)) result = td;
  }
  return result;
}

// Signed area of a closed polyline (positive = CCW in standard math axes).
export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

// Adaptive subdivision of a cubic Bezier into line segments.
// flatnessTol is in EM units; recursion is depth-limited.
export function flattenCubic(p0, c1, c2, p3, flatnessTol = 0.05) {
  const out = [];
  const split = (a, b, c, d, depth) => {
    if (depth > 18) return;
    // Control polygon flatness: max distance of control points from chord.
    const flat = Math.max(
      Math.sqrt(pointSegmentDistance2(b, a, d)),
      Math.sqrt(pointSegmentDistance2(c, a, d))
    );
    if (flat <= flatnessTol) {
      out.push(d);
      return;
    }
    const ab = mid(a, b);
    const bc = mid(b, c);
    const cd = mid(c, d);
    const abc = mid(ab, bc);
    const bcd = mid(bc, cd);
    const abcd = mid(abc, bcd);
    split(a, ab, abc, abcd, depth + 1);
    split(abcd, bcd, cd, d, depth + 1);
  };
  split(p0, c1, c2, p3, 0);
  return out;
}

export function flattenQuad(p0, c, p1, flatnessTol = 0.05) {
  // Promote quadratic to cubic: c1 = p0 + 2/3 (c - p0), c2 = p1 + 2/3 (c - p1)
  const c1 = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
  const c2 = { x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) };
  return flattenCubic(p0, c1, c2, p1, flatnessTol);
}

function mid(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

// Winding number of point p relative to closed polyline points.
// Standard math orientation (y up): a CCW loop returns +1 around its interior.
export function windingNumber(p, points) {
  let wn = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y <= p.y) {
      if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) wn--;
    } else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) {
      wn++;
    }
  }
  return wn;
}

// Even-odd crossing count (parity inside test).
export function evenOddInside(p, contours) {
  let crossings = 0;
  for (const contour of contours) {
    const points = contour.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y > p.y) !== (b.y > p.y)) {
        const xHit = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (xHit > p.x) crossings++;
      }
    }
  }
  return (crossings & 1) === 1;
}

// Global inside test over all contours of a shape.
export function insideAt(p, shape, rule = WINDING.NONZERO) {
  if (rule === WINDING.EVENODD) return evenOddInside(p, shape.contours);
  let wn = 0;
  for (const contour of shape.contours) wn += windingNumber(p, contour.points);
  return wn !== 0;
}
