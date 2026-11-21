// Contour orientation normalization.
//
// MSDF per-channel pseudo-distances rely on edge-local signs: for a directed
// edge a->b the left side (cross(aq, ab) > 0) reads as "inside". That only
// matches the shape when outer contours run CCW and holes CW. We determine
// each contour's nesting depth by point-in-contour tests and reorient.

import { polygonArea, windingNumber } from './geometry.js';

function pointInContour(p, contour) {
  return windingNumber(p, contour.points) !== 0;
}

export function normalizeContours(shape) {
  const contours = shape.contours.map((c) => ({ points: c.points.map((p) => ({ ...p })) }));
  const depth = new Array(contours.length).fill(0);

  for (let i = 0; i < contours.length; i++) {
    const sample = contours[i].points[0];
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (pointInContour(sample, contours[j])) depth[i]++;
    }
  }

  for (let i = 0; i < contours.length; i++) {
    const ccw = polygonArea(contours[i].points) > 0;
    const shouldBeCCW = depth[i] % 2 === 0;
    if (ccw !== shouldBeCCW) contours[i].points.reverse();
  }
  return { name: shape.name, contours, depth };
}
