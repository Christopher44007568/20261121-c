// Public entry point: integer-grid area-boolean operations with diagnostics.

import { Diagnostics } from "./diagnostics.js";
import { quantize } from "./quantize.js";
import { buildArrangement, pointKey } from "./arrangement.js";
import { splitSelfTouchingLoops } from "./split-touch.js";
import {
  assembleLoops,
  computeFaceWinding,
  selectBoundaryEdges,
} from "./winding.js";
import {
  classifyDegenerateEdges,
  classifyLoops,
  simplifyRing,
  signedArea2,
  verifyTriangulable,
} from "./polygon.js";

export const OPERATIONS = ["union", "intersection", "difference", "xor"];

export function booleanPolygons(polygonSets, options = {}) {
  const diag = new Diagnostics();
  const operation = options.operation ?? "union";
  if (!OPERATIONS.includes(operation)) {
    diag.error("E_TRIVIAL_INPUT", { reason: `unknown operation ${operation}` });
    return emptyResult(operation, diag);
  }
  if (!Array.isArray(polygonSets) || polygonSets.length < 2) {
    diag.error("E_TRIVIAL_INPUT", { given: polygonSets?.length ?? 0 });
    return emptyResult(operation, diag);
  }

  const rule = options.fillRule ?? "nonzero";
  const quantized = quantize(polygonSets, options, diag);
  const setIds = quantized.map((s) => s.id);

  const mergedEdges = buildArrangement(quantized, diag);
  const sourceSegments = collectSourceSegments(quantized);
  computeFaceWinding(mergedEdges, sourceSegments, rule);

  const boundary = selectBoundaryEdges(mergedEdges, operation, setIds, rule);
  const loops = assembleLoops(boundary);
  const simpleLoops = splitSelfTouchingLoops(loops);
  const polygons = classifyLoops(simpleLoops, diag);

  const boundaryKeys = new Set(boundary.map(({ edge }) => edge.key));
  const degenerateEdges = classifyDegenerateEdges(mergedEdges, boundaryKeys);

  const triangulation = polygons.map((poly, i) =>
    verifyTriangulable(poly, diag, i),
  );
  const triangulable = triangulation.every((t) => t.ok);

  if (!polygons.length) diag.info("I_ZERO_RESULT", {});

  return {
    operation,
    fillRule: rule,
    scale: options.scale ?? 1,
    setIds,
    polygons: polygons.map((p, i) => ({
      outer: exportRing(simplifyRing(p.outer)),
      holes: p.holes.map((h) => exportRing(simplifyRing(h))),
      area2: p.area2.toString(),
      area: p.area2.toNumber() / 2,
      triangles: triangulation[i].triangles,
    })),
    degenerateEdges: degenerateEdges.map((e) => ({
      a: exportPoint(e.a),
      b: exportPoint(e.b),
      tags: e.tags,
    })),
    quantizedInputs: quantized,
    diagnostics: diag.toJSON(),
    metrics: {
      atomicEdges: mergedEdges.length,
      boundaryEdges: boundary.length,
      loopCount: loops.length,
      polygonCount: polygons.length,
      triangulable,
    },
  };
}

function collectSourceSegments(sets) {
  const segments = [];
  for (const set of sets) {
    for (const poly of set.polygons) {
      for (const ring of poly.rings.filter((r) => r.length >= 3)) {
        for (let i = 0; i < ring.length; i++) {
          segments.push({
            a: ring[i],
            b: ring[(i + 1) % ring.length],
            setId: set.id,
          });
        }
      }
    }
  }
  return segments;
}

function exportRing(ring) {
  return ring.map(exportPoint);
}

function exportPoint(p) {
  return { x: p.x.toString(), y: p.y.toString(), n: [p.x.n, p.x.d, p.y.n, p.y.d] };
}

function emptyResult(operation, diag) {
  return {
    operation,
    polygons: [],
    degenerateEdges: [],
    diagnostics: diag.toJSON(),
    metrics: { atomicEdges: 0, boundaryEdges: 0, loopCount: 0, polygonCount: 0, triangulable: true },
  };
}

export { Diagnostics, signedArea2, pointKey };
