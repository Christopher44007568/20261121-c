// Split a flattened subpath into dash pieces following SVG stroke-dasharray.
// Closed subpaths wrap dash intervals across the start/end seam.

'use strict';

const { arcLengths, vlen, vsub } = require('./geometry');

function normalizeDashArray(dasharray) {
  if (!dasharray || dasharray.length === 0) return null;
  const values = dasharray.map((value) => Math.abs(Number(value)));
  if (values.every((value) => value === 0)) return null;
  // An odd-length pattern is doubled per SVG spec.
  if (values.length % 2 === 1) values.push(...values);
  return values;
}

// Point + tangent at arc length `target`, clipped to [0, total]. The point list
// must already include every segment (closed rings pass an explicit closing
// vertex, see dashSubpath).
function pointAtLength(points, lengths, target) {
  const total = lengths[lengths.length - 1];
  const distance = Math.max(0, Math.min(total, target));
  let seg = 0;
  while (seg < lengths.length - 2 && lengths[seg + 1] <= distance) seg += 1;
  const segLen = lengths[seg + 1] - lengths[seg];
  const u = segLen < 1e-15 ? 0 : (distance - lengths[seg]) / segLen;
  const a = points[seg];
  const b = points[seg + 1];
  const point = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  const dir = vsub(b, a);
  const len = vlen(dir);
  const tangent = len < 1e-15 ? { x: 1, y: 0 } : { x: dir.x / len, y: dir.y / len };
  return { point, tangent };
}

// Dense polyline sample over [from, to] on an already-extended point list.
function slicePolyline(points, lengths, from, to, stepsPerUnit) {
  const span = to - from;
  const steps = Math.max(2, Math.ceil(span * stepsPerUnit));
  const result = [];
  for (let i = 0; i <= steps; i += 1) {
    result.push(pointAtLength(points, lengths, from + (span * i) / steps).point);
  }
  return result;
}

// Return dash pieces: [{ points, closed, startCap, endCap, seam? }].
function dashSubpath(flat, dasharray, dashoffset = 0, stepsPerUnit = 1) {
  const pattern = normalizeDashArray(dasharray);
  const isClosed = flat.closed;

  // Closed rings get a repeated first vertex so the wrapping segment (last ->
  // first) is a normal segment and the length table covers the full perimeter.
  const points = isClosed ? flat.points.concat([flat.points[0]]) : flat.points;
  const lengths = arcLengths(points);
  const total = lengths[lengths.length - 1];

  if (!pattern) {
    return [{
      points: flat.points,
      closed: isClosed,
      startCap: isClosed ? null : 'start',
      endCap: isClosed ? null : 'end',
    }];
  }
  if (total < 1e-12) {
    // Zero-length subpath: SVG renders nothing for a dashed stroke.
    return [];
  }

  const period = pattern.reduce((sum, value) => sum + value, 0);
  const pieces = [];

  // Walk pattern intervals along the length axis. A negative start comes from
  // a positive dash offset. For closed rings, normalize interval starts modulo
  // the perimeter and deduplicate, so a seam-crossing dash emits exactly once.
  const startPhase = -(((dashoffset % period) + period) % period);
  let phase = startPhase;
  let patternIndex = 0;
  let on = true;
  const emittedStarts = new Set();
  let guard = 0;
  while (phase < total && guard < 100000) {
    guard += 1;
    const segmentLength = pattern[patternIndex % pattern.length];
    const next = phase + segmentLength;
    if (on && segmentLength > 0) emitPiece(phase, next);
    phase = next;
    patternIndex += 1;
    on = !on;
  }

  function emitPiece(rawFrom, rawTo) {
    const span = rawTo - rawFrom;
    if (!isClosed) {
      const from = Math.max(0, rawFrom);
      const to = Math.min(total, rawTo);
      if (to > from) {
        pieces.push({
          points: slicePolyline(points, lengths, from, to, stepsPerUnit),
          closed: false,
          startCap: 'start',
          endCap: 'end',
        });
      }
      return;
    }

    if (span >= total) {
      pieces.push({
        points: flat.points.map((point) => ({ ...point })),
        closed: true,
        startCap: null,
        endCap: null,
      });
      return;
    }

    // Map into [0, total) and allow one forward wrap across the seam. A dash
    // that crosses the seam is sampled as two intervals and concatenated, with
    // the seam vertex retained so its corner join is preserved.
    const from = ((rawFrom % total) + total) % total;
    const key = Math.round(from * 1000);
    if (emittedStarts.has(key)) return;
    emittedStarts.add(key);
    const wraps = from + span > total;
    let sampled;
    if (!wraps) {
      sampled = slicePolyline(points, lengths, from, from + span, stepsPerUnit);
    } else {
      const first = slicePolyline(points, lengths, from, total, stepsPerUnit);
      const remainder = from + span - total;
      const second = slicePolyline(points, lengths, 0, remainder, stepsPerUnit);
      sampled = first.concat(second.slice(1));
    }
    pieces.push({
      points: sampled,
      closed: false,
      startCap: 'start',
      endCap: 'end',
      seam: wraps,
    });
  }

  return pieces;
}

module.exports = { normalizeDashArray, dashSubpath, pointAtLength };
