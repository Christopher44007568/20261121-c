// Turn parsed subpaths into dense polylines suitable for offsetting.

'use strict';

const {
  flattenCubic,
  flattenQuadratic,
  arcToCubics,
  vlen,
  vsub,
} = require('./geometry');

// Flatten one subpath. Returns { points, closed, zeroLength, start }.
function flattenSubpath(subpath, tolerance) {
  const start = subpath.start;
  if (subpath.segments.length === 0) {
    return { points: [{ ...start }], closed: false, zeroLength: true, start: { ...start } };
  }
  const points = [{ ...start }];
  for (const segment of subpath.segments) {
    if (segment.type === 'L') {
      points.push({ ...segment.to });
    } else if (segment.type === 'C') {
      const part = [];
      flattenCubic(segment.from, segment.c1, segment.c2, segment.to, tolerance, part);
      for (let i = 1; i < part.length; i += 1) points.push(part[i]);
    } else if (segment.type === 'Q') {
      const part = [];
      flattenQuadratic(segment.from, segment.c, segment.to, tolerance, part);
      for (let i = 1; i < part.length; i += 1) points.push(part[i]);
    } else if (segment.type === 'A') {
      const cubics = arcToCubics(
        segment.from,
        segment.rx,
        segment.ry,
        segment.xAxisRotation,
        segment.largeArc,
        segment.sweep,
        segment.to,
      );
      for (const cubic of cubics) {
        const part = [];
        flattenCubic(cubic.p0, cubic.p1, cubic.p2, cubic.p3, tolerance, part);
        for (let i = 1; i < part.length; i += 1) points.push(part[i]);
      }
    }
  }

  const closed = subpath.closed;
  if (closed) {
    // Drop a duplicated closing point; the ring is implicit.
    const first = points[0];
    const last = points[points.length - 1];
    if (vlen(vsub(last, first)) < 1e-9) points.pop();
  }

  let zeroLength = true;
  for (let i = 1; i < points.length; i += 1) {
    if (vlen(vsub(points[i], points[0])) > 1e-9) {
      zeroLength = false;
      break;
    }
  }
  if (zeroLength && points.length > 1) points.length = 1;

  return { points, closed, zeroLength, start: { ...start } };
}

function flattenPath(subpaths, tolerance = 0.2) {
  return subpaths.map((subpath) => flattenSubpath(subpath, tolerance));
}

module.exports = { flattenPath, flattenSubpath };
