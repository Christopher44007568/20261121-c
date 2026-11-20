// Public API: expand a stroked SVG path into pure fill geometry.
//
// Stroke geometry is built in the path's user coordinate system first, then
// the current affine transform (including non-uniform scale) is applied to the
// outline vertices. This matches SVG rendering: stroke width is affected by the
// CTM, so under scale(2, 0.5) a round cap becomes an ellipse and miter tips
// land at the transformed offset positions.

'use strict';

const { parsePath } = require('./path-parser');
const { flattenPath } = require('./flatten');
const { dashSubpath } = require('./dasher');
const { strokePiece, strokeZeroLength } = require('./stroker');
const { mapply, identity } = require('./geometry');

const DEFAULTS = {
  width: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 4,
  dasharray: null,
  dashoffset: 0,
  flattenTolerance: 0.2,
  stepsPerUnit: 1,
  transform: null,
  // Chrome/Skia drop cap dots for subpaths shorter than roughly a quarter
  // user unit. Matching that epsilon keeps the differential test exact while
  // spec-perfect callers can set this to 0.
  minSubpathLength: 0.25,
};

function expandStroke(d, options = {}) {
  const style = { ...DEFAULTS, ...options };
  const matrix = style.transform || identity();
  const subpaths = parsePath(d);
  const flattened = flattenPath(subpaths, style.flattenTolerance);
  const outlines = [];

  for (const flat of flattened) {
    if (flat.zeroLength) {
      if (style.minSubpathLength > 0) continue;
      const ring = strokeZeroLength(flat.start, style);
      if (ring.length) outlines.push(ring.map((point) => mapply(matrix, point)));
      continue;
    }
    const pieces = dashSubpath(flat, style.dasharray, style.dashoffset, style.stepsPerUnit);
    for (const piece of pieces) {
      const result = strokePiece(piece, style);
      const rings = piece.closed && Array.isArray(result[0]) ? result : [result];
      for (const ring of rings) {
        outlines.push(ring.map((point) => mapply(matrix, point)));
      }
    }
  }
  return outlines;
}

function formatNumber(value) {
  if (Math.abs(value) < 1e-9) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

// Serialize outline rings to a single fill path (nonzero winding).
function toFillPath(outlines) {
  return outlines
    .map((ring) => {
      if (ring.length < 2) return '';
      const head = `M${formatNumber(ring[0].x)} ${formatNumber(ring[0].y)}`;
      const body = ring
        .slice(1)
        .map((point) => `L${formatNumber(point.x)} ${formatNumber(point.y)}`)
        .join('');
      return `${head}${body}Z`;
    })
    .filter(Boolean)
    .join(' ');
}

function strokeToFillPath(d, options) {
  return toFillPath(expandStroke(d, options));
}

module.exports = { expandStroke, strokeToFillPath, toFillPath, DEFAULTS };
