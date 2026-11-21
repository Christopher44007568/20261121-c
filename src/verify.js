// Acceptance cross-checks independent of the boolean engine:
//  1. area identities (union/inclusion-exclusion, difference, xor)
//  2. raster coverage sampled on the integer grid, compared cell-by-cell

import { signedArea2 } from "./polygon.js";
import { pointWinding } from "./winding.js";
import { Q } from "./rational.js";

export function totalArea2(sets, onlySetId = null) {
  let area = new Q(0n);
  for (const set of sets) {
    if (onlySetId !== null && set.id !== onlySetId) continue;
    for (const poly of set.polygons) {
      poly.rings.filter((r) => r.length >= 3).forEach((ring, ringIndex) => {
        const raw = signedArea2(ring);
        const magnitude = raw.n < 0n ? raw.neg() : raw;
        area = area.add(ringIndex === 0 ? magnitude : magnitude.neg());
      });
    }
  }
  return area;
}

// Inclusion-exclusion for two sets using the three primitive results.
export function checkAreaIdentity(unionR, interR, aSets, bSets, diag) {
  const idA = unionR.setIds[0];
  const idB = unionR.setIds[1];
  const areaA = totalArea2(aSets, idA).mul(new Q(1n, 2n));
  const areaB = totalArea2(bSets, idB).mul(new Q(1n, 2n));
  const unionArea = sumResultArea(unionR);
  const interArea = sumResultArea(interR);
  const expected = areaA.add(areaB);
  const actual = unionArea.add(interArea);
  const ok = expected.equals(actual);
  if (!ok) {
    diag.error("E_AREA_IDENTITY", { expected: expected.toString(), actual: actual.toString() });
  }
  return { ok, areaA, areaB, unionArea, interArea };
}

function sumResultArea(result) {
  const doubled = result.polygons.reduce(
    (sum, p) => sum.add(parseQ(p.area2)),
    new Q(0n),
  );
  return doubled.mul(new Q(1n, 2n));
}

function parseQ(text) {
  const [n, d = "1"] = String(text).split("/");
  return new Q(BigInt(n), BigInt(d));
}

export function checkDifferenceIdentity(diffR, aSets, interR, diag) {
  const areaA = totalArea2(aSets, diffR.setIds[0]).mul(new Q(1n, 2n));
  const diffArea = sumResultArea(diffR);
  const interArea = sumResultArea(interR);
  const ok = areaA.equals(diffArea.add(interArea));
  if (!ok) diag.error("E_AREA_IDENTITY", { identity: "A-B + A∩B = A" });
  return { ok, areaA, diffArea, interArea };
}

// Rasterise every set and the result over the same bounding box. Cell centers
// sit at half-integer positions, so no cell center ever lies on an integer
// grid edge -- the winding test stays unambiguous.
export function rasterCrossCheck(result, sets, operation, options = {}) {
  const box = boundingBox(sets, result);
  const mismatches = [];
  const samples = { expected: 0, actual: 0, compared: 0 };
  const cell = options.cell ?? 1;

  for (let gx = box.minX; gx < box.maxX; gx += cell) {
    for (let gy = box.minY; gy < box.maxY; gy += cell) {
      const point = { x: rat(gx * 2 + 1, 2), y: rat(gy * 2 + 1, 2) };
      const membership = sets.map((set) => coversPoint(set, point, options.fillRule ?? "nonzero"));
      const expected = applySetOp(operation, membership);
      const actual = resultCovers(result, point);
      samples.compared++;
      if (expected) samples.expected++;
      if (actual) samples.actual++;
      if (expected !== actual) {
        mismatches.push({ x: gx + 0.5, y: gy + 0.5, expected, actual });
      }
    }
  }
  return {
    ok: mismatches.length === 0,
    mismatches: mismatches.slice(0, 20),
    mismatchCount: mismatches.length,
    samples,
    bounds: box,
  };
}

function rat(n, d) {
  return new Q(BigInt(n), BigInt(d));
}

function coversPoint(set, point, rule) {
  let winding = 0;
  for (const poly of set.polygons) {
    winding += pointWinding(point, poly.rings.filter((r) => r.length >= 3));
  }
  return rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
}

function resultCovers(result, point) {
  for (const poly of result.polygons) {
    let inside = false;
    const rings = [poly.outer.map(fromExport), ...poly.holes.map((h) => h.map(fromExport))];
    for (const ring of rings) {
      if (pointWinding(point, [ring]) !== 0) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function fromExport(p) {
  return {
    x: new Q(BigInt(p.n[0]), BigInt(p.n[1])),
    y: new Q(BigInt(p.n[2]), BigInt(p.n[3])),
  };
}

function applySetOp(operation, membership) {
  switch (operation) {
    case "union":
      return membership.some(Boolean);
    case "intersection":
      return membership.every(Boolean);
    case "difference":
      return membership[0] && membership.slice(1).every((v) => !v);
    case "xor":
      return membership.filter(Boolean).length % 2 === 1;
    default:
      return false;
  }
}

export function boundingBox(sets, result) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (p) => {
    const x = coordNumber(p, "x");
    const y = coordNumber(p, "y");
    minX = Math.min(minX, Math.floor(x));
    minY = Math.min(minY, Math.floor(y));
    maxX = Math.max(maxX, Math.ceil(x));
    maxY = Math.max(maxY, Math.ceil(y));
  };
  for (const set of sets) {
    for (const poly of set.polygons) {
      for (const ring of poly.rings) ring.forEach(eat);
    }
  }
  for (const poly of result.polygons || []) {
    poly.outer.forEach(eat);
    poly.holes.forEach((h) => h.forEach(eat));
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function coordNumber(p, axis) {
  const v = p[axis];
  if (typeof v?.toNumber === "function") return v.toNumber();
  if (Array.isArray(p.n)) {
    const idx = axis === "x" ? [0, 1] : [2, 3];
    return Number(BigInt(p.n[idx[0]])) / Number(BigInt(p.n[idx[1]]));
  }
  return Number(v);
}
