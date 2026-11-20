// Basic 2D vector math, affine matrices, cubic flattening and arc helpers.
// Matrices are [a, b, c, d, e, f] meaning:
//   | a c e |
//   | b d f |
//   | 0 0 1 |

'use strict';

function vadd(p, q) {
  return { x: p.x + q.x, y: p.y + q.y };
}

function vsub(p, q) {
  return { x: p.x - q.x, y: p.y - q.y };
}

function vscale(p, k) {
  return { x: p.x * k, y: p.y * k };
}

function vdot(p, q) {
  return p.x * q.x + p.y * q.y;
}

function vcross(p, q) {
  return p.x * q.y - p.y * q.x;
}

function vlen(p) {
  return Math.hypot(p.x, p.y);
}

function vnorm(p) {
  const l = Math.hypot(p.x, p.y);
  if (l < 1e-15) return { x: 0, y: 0 };
  return { x: p.x / l, y: p.y / l };
}

// Left-hand normal of a direction vector (screen coordinates, y down).
function vnormal(p) {
  const l = Math.hypot(p.x, p.y);
  if (l < 1e-15) return { x: 0, y: 0 };
  return { x: -p.y / l, y: p.x / l };
}

function vrot90(p) {
  return { x: -p.y, y: p.x };
}

function identity() {
  return [1, 0, 0, 1, 0, 0];
}

function mconcat(m1, m2) {
  // m1 then m2, i.e. result = m2 * m1
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

function mapply(m, p) {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

function mscale(sx, sy) {
  return [sx, 0, 0, sy, 0, 0];
}

function mrotate(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

function mtranslate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

// Decompose a matrix into non-uniform scale + rotation (polar decomposition).
// Returns { rotation, scale: {x, y} }.
function mdecompose(m) {
  const [a, b, c, d] = m;
  // Column 0 length gives sx candidate; use SVD-lite via rotation extraction.
  const sx0 = Math.hypot(a, b);
  const sy0 = Math.hypot(c, d);
  const rotation = Math.atan2(b / sx0, a / sx0);
  // Determinant sign preserves reflections.
  const det = a * d - b * c;
  const sy = (det < 0 ? -1 : 1) * sy0;
  return { rotation, scale: { x: sx0, y: sy } };
}

// Adaptive flattening of a cubic Bezier into polylines.
// Recursively subdivides until the control polygon is within `tolerance`.
function flattenCubic(p0, p1, p2, p3, tolerance, out) {
  const tol2 = tolerance * tolerance;

  function recurse(a, b, c, d, depth) {
    if (depth === 0) {
      out.push(d);
      return;
    }
    // Distance of the two inner control points from the chord a->d.
    const chord = vsub(d, a);
    const chordLen2 = vdot(chord, chord);
    let dist1;
    let dist2;
    if (chordLen2 < 1e-18) {
      dist1 = vlen(vsub(b, a));
      dist2 = vlen(vsub(c, a));
    } else {
      const n = vnormal(chord);
      dist1 = Math.abs(vdot(vsub(b, a), n));
      dist2 = Math.abs(vdot(vsub(c, a), n));
    }
    if (dist1 * dist1 <= tol2 && dist2 * dist2 <= tol2) {
      out.push(d);
      return;
    }
    const ab = vscale(vadd(a, b), 0.5);
    const bc = vscale(vadd(b, c), 0.5);
    const cd = vscale(vadd(c, d), 0.5);
    const abc = vscale(vadd(ab, bc), 0.5);
    const bcd = vscale(vadd(bc, cd), 0.5);
    const mid = vscale(vadd(abc, bcd), 0.5);
    recurse(a, ab, abc, mid, depth - 1);
    recurse(mid, bcd, cd, d, depth - 1);
  }

  out.push(p0);
  recurse(p0, p1, p2, p3, 18);
}

function flattenQuadratic(p0, p1, p2, tolerance, out) {
  // Promote to cubic.
  const c1 = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
  const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
  flattenCubic(p0, c1, c2, p2, tolerance, out);
}

// Convert an SVG elliptical arc command to cubic Bezier segments.
// Implementation follows the SVG 1.1 arc-to-center parameterization.
function arcToCubics(p0, rx, ry, xAxisRotation, largeArc, sweep, p1) {
  let rxp = Math.abs(rx);
  let ryp = Math.abs(ry);
  if (rxp < 1e-12 || ryp < 1e-12) {
    return [{ p0, p1: p0, p2: p1, p3: p1 }];
  }
  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const rx2 = rxp * rxp;
  const ry2 = ryp * ryp;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  let lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxp *= s;
    ryp *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  const den = rx2 * y1p2 + ry2 * x1p2;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rxp * y1p) / ryp;
  const cyp = (-coef * ryp * x1p) / rxp;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rxp, (y1p - cyp) / ryp);
  let dtheta = angle(
    (x1p - cxp) / rxp,
    (y1p - cyp) / ryp,
    (-x1p - cxp) / rxp,
    (-y1p - cyp) / ryp,
  );
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);
  const cubics = [];
  let theta = theta1;
  let start = p0;
  for (let i = 0; i < segments; i += 1) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosE = Math.cos(theta + delta);
    const sinE = Math.sin(theta + delta);
    const point = (ct, st) => ({
      x: cx + rxp * (cosPhi * ct - sinPhi * st),
      y: cy + ryp * (sinPhi * ct + cosPhi * st),
    });
    const end = point(cosE, sinE);
    const c1 = {
      x: start.x + t * (-rxp * (cosPhi * sinT + sinPhi * cosT)),
      y: start.y + t * (-ryp * (sinPhi * sinT - cosPhi * cosT)),
    };
    const c2 = {
      x: end.x + t * (rxp * (cosPhi * sinE + sinPhi * cosE)),
      y: end.y + t * (ryp * (sinPhi * sinE - cosPhi * cosE)),
    };
    cubics.push({ p0: start, p1: c1, p2: c2, p3: end });
    start = end;
    theta += delta;
  }
  return cubics;
}

// Cumulative arc length along a flattened polyline.
function arcLengths(points) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += vlen(vsub(points[i], points[i - 1]));
    lengths.push(total);
  }
  return lengths;
}

// Resample a polyline at a fixed arc-length step, keeping parameter t for each.
function resampleByLength(points, lengths, step) {
  const total = lengths[lengths.length - 1];
  const samples = [];
  let seg = 0;
  const count = Math.max(1, Math.floor(total / step));
  for (let i = 0; i <= count; i += 1) {
    const target = Math.min(total, i * step);
    while (seg < lengths.length - 2 && lengths[seg + 1] < target) seg += 1;
    const segLen = lengths[seg + 1] - lengths[seg];
    const u = segLen < 1e-15 ? 0 : (target - lengths[seg]) / segLen;
    const a = points[seg];
    const b = points[seg + 1];
    samples.push({
      point: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u },
      t: total < 1e-15 ? 0 : target / total,
    });
  }
  if (samples.length && vlen(vsub(samples[samples.length - 1].point, points[points.length - 1])) > 1e-9) {
    samples.push({ point: points[points.length - 1], t: 1 });
  }
  return samples;
}

module.exports = {
  vadd,
  vsub,
  vscale,
  vdot,
  vcross,
  vlen,
  vnorm,
  vnormal,
  vrot90,
  identity,
  mconcat,
  mapply,
  mscale,
  mrotate,
  mtranslate,
  mdecompose,
  flattenCubic,
  flattenQuadratic,
  arcToCubics,
  arcLengths,
  resampleByLength,
};
