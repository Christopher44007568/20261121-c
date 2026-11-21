// MSDF edge coloring.
//
// Traversal-based edge coloring following msdfgen's edgeColoringSimple.
//
// Every segment gets a two-channel mask. Walking along a closed contour the
// mask only changes at sharp corners (turn angle above the threshold), where
// it rotates to the next pair. Adjacent edges therefore share one channel at
// sharp joins (median keeps the corner sharp) and both channels along smooth
// curves. A fully smooth contour is forced to rotate once so all three pairs
// appear, which is what keeps the two sides of a curved counter separated.

export const R = 1;
export const G = 2;
export const B = 4;
export const PAIRS = [R | G, G | B, B | R];

function turnAngle(a, b, c) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lu = Math.hypot(ux, uy) || 1;
  const lv = Math.hypot(vx, vy) || 1;
  const dot = (ux * vx + uy * vy) / (lu * lv);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// Assign a per-segment 3-bit mask for one closed polyline.
export function colorContour(points, cornerThreshold = (25 * Math.PI) / 180) {
  const n = points.length;
  const masks = new Array(n);
  if (n < 3) {
    for (let i = 0; i < n; i++) masks[i] = PAIRS[0];
    return masks;
  }

  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    if (turnAngle(a, b, c) >= cornerThreshold) corners.push(i);
  }

  if (corners.length === 0) {
    // Smooth closed contour: spread all three pairs evenly around the loop
    // (msdfgen's teardrop trichotomy) so no region is monochromatic.
    for (let i = 0; i < n; i++) masks[i] = PAIRS[Math.floor((3 * i + 1) / n) % 3];
    return masks;
  }

  // Corner-driven traversal: rotate the pair at every sharp vertex.
  let pairIdx = 0;
  for (let i = 0; i < n; i++) {
    if (corners.includes(i)) pairIdx = (pairIdx + 1) % 3;
    masks[i] = PAIRS[pairIdx];
  }
  return masks;
}

// Flatten shape into renderable segments with masks and owning contour index.
export function buildSegments(shape, cornerThreshold) {
  const segments = [];
  shape.contours.forEach((contour, ci) => {
    const masks = colorContour(contour.points, cornerThreshold);
    const n = contour.points.length;
    for (let i = 0; i < n; i++) {
      segments.push({
        a: contour.points[i],
        b: contour.points[(i + 1) % n],
        mask: masks[i],
        contour: ci,
      });
    }
  });
  return segments;
}
