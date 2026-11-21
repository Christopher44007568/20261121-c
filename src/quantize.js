import { Q } from "./rational.js";

// Snaps floating-point coordinates onto an integer grid.
//
// Diagnostics emitted here:
//   E_NON_FINITE        coordinate is NaN/Infinity (feature rejected)
//   W_NEAR_THRESHOLD    scaled coordinate sits close to a k+0.5 rounding boundary
//   W_COLLAPSED_EDGE    an edge collapsed to a point after snapping
//   W_DEGENERATE_RING   a ring has fewer than 3 distinct vertices

export const DEFAULT_NEAR_EPS = 0.025; // fraction of one grid unit

function roundHalfUp(v) {
  // Deterministic half-up rounding; ties at +0.5 go up, ties at -0.5 go down.
  return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
}

export function quantize(polygonSets, options = {}, diag) {
  const scale = options.scale ?? 1;
  if (!Number.isInteger(scale) || scale <= 0) {
    throw new Error("quantize: scale must be a positive integer");
  }
  const nearEps = options.nearEps ?? DEFAULT_NEAR_EPS;

  const out = polygonSets.map((set, setIndex) => ({
    id: set.id ?? `set-${setIndex}`,
    polygons: (set.polygons || []).map((poly, polyIndex) => {
      const rings = normalizeRings(poly).map((ring, ringIndex) =>
        snapRing(ring, scale, nearEps, diag, setIndex, polyIndex, ringIndex),
      );
      return { id: poly.id ?? `p-${setIndex}-${polyIndex}`, rings };
    }),
  }));
  return out;
}

function normalizeRings(poly) {
  if (Array.isArray(poly.rings)) return poly.rings;
  if (poly.outer) return [poly.outer, ...(poly.holes || [])];
  throw new Error("polygon requires either {rings} or {outer, holes}");
}

function snapRing(ring, scale, nearEps, diag, setIndex, polyIndex, ringIndex) {
  const loc = { set: setIndex, polygon: polyIndex, ring: ringIndex };
  const snapped = [];
  for (const [i, pt] of ring.entries()) {
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      diag.error("E_NON_FINITE", { ...loc, vertex: i, x: pt[0], y: pt[1] });
      throw new Error(`non-finite coordinate at set${setIndex}/poly${polyIndex}/ring${ringIndex}#${i}`);
    }
    const sx = x * scale;
    const sy = y * scale;
    flagNearThreshold(sx, "x", i, loc, nearEps, diag);
    flagNearThreshold(sy, "y", i, loc, nearEps, diag);
    snapped.push({ x: new Q(BigInt(roundHalfUp(sx))), y: new Q(BigInt(roundHalfUp(sy))) });
  }

  const cleaned = [];
  for (const p of snapped) {
    const last = cleaned[cleaned.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (first.x === last.x && first.y === last.y) cleaned.pop();
  }
  if (cleaned.length !== snapped.length) {
    diag.warn("W_COLLAPSED_EDGE", {
      ...loc,
      before: snapped.length,
      after: cleaned.length,
    });
  }
  if (cleaned.length < 3) {
    diag.warn("W_DEGENERATE_RING", { ...loc, distinctVertices: cleaned.length });
  }
  return cleaned;
}

function flagNearThreshold(scaled, axis, vertex, loc, nearEps, diag) {
  const nearest = roundHalfUp(scaled);
  // The two half-integer boundaries nearest to the rounded value.
  const dist = Math.min(Math.abs(scaled - (nearest - 0.5)), Math.abs(scaled - (nearest + 0.5)));
  if (dist < nearEps) {
    diag.warn("W_NEAR_THRESHOLD", {
      ...loc,
      vertex,
      axis,
      scaledValue: scaled,
      distanceToBoundary: dist,
      snappedTo: nearest,
    });
  }
}
