// Builds a planar arrangement: every input edge is cut at every intersection
// (proper crossing, T-junction, collinear overlap, tangent), so the output
// atomic edges have no interior intersections. All arithmetic stays rational.

import { Q } from "./rational.js";
import {
  orient,
  pointOnSegment,
  pointsEqual,
  segmentIntersection,
  segmentParam,
} from "./geometry-int.js";

export function buildArrangement(sets, diag) {
  const rawEdges = collectEdges(sets, diag);
  const splitEdges = splitAllEdges(rawEdges, diag);
  return mergeAtomicEdges(splitEdges);
}

function collectEdges(sets, diag) {
  const edges = [];
  for (const set of sets) {
    for (const poly of set.polygons) {
      const rings = poly.rings.filter((ring) => ring.length >= 3);
      for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
        const ring = rings[ringIndex];
        const signedArea = ringArea(ring);
        const expected = ringIndex === 0 ? 1 : -1;
        const orientation = signedArea.n > 0n ? 1 : -1;
        if (orientation !== expected) {
          diag.warn("W_UNWOUND_RING", {
            set: sets.indexOf(set),
            polygon: poly.id,
            ring: ringIndex,
            expected: expected === 1 ? "CCW" : "CW",
          });
        }
        // The winding jump across a directed boundary edge is always +1 from
        // its right face to its left face; ring orientation is already carried
        // by the edge direction itself, so no extra sign factor is needed.
        void orientation;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          edges.push({
            a,
            b,
            setId: set.id,
            ringIndex,
            polygonId: poly.id,
            sign: 1,
            direction: 1,
          });
        }
      }
    }
  }
  return edges;
}

export function ringArea(ring) {
  // Doubled signed area, exact integer (or rational) value.
  let area = new Q(0n);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area = area.add(a.x.mul(b.y).sub(a.y.mul(b.x)));
  }
  return area;
}

function splitAllEdges(rawEdges, diag) {
  const out = [];
  for (let i = 0; i < rawEdges.length; i++) {
    const edge = rawEdges[i];
    const cuts = new Map();
    cuts.set(pointKey(edge.a), edge.a);
    cuts.set(pointKey(edge.b), edge.b);

    for (let j = 0; j < rawEdges.length; j++) {
      if (i === j) continue;
      const other = rawEdges[j];
      const hit = segmentIntersection(edge.a, edge.b, other.a, other.b);
      if (!hit.points.length) continue;
      for (const p of hit.points) {
        if (pointOnSegment(p, edge.a, edge.b)) {
          const key = pointKey(p);
          if (!cuts.has(key)) {
            cuts.set(key, p);
            if (hit.proper || !isEndpoint(p, edge)) {
              diag.info("W_SPLIT_INTERSECTION", {
                x: p.x.toString(),
                y: p.y.toString(),
              });
            }
          }
        }
      }
    }

    const ordered = [...cuts.values()].sort((p, q) =>
      segmentParam(p, edge.a, edge.b).cmp(segmentParam(q, edge.a, edge.b)),
    );
    for (let k = 0; k < ordered.length - 1; k++) {
      if (pointsEqual(ordered[k], ordered[k + 1])) continue;
      out.push({
        a: ordered[k],
        b: ordered[k + 1],
        source: {
          setId: edge.setId,
          polygonId: edge.polygonId,
          ringIndex: edge.ringIndex,
          sign: edge.sign,
          direction: edge.direction,
        },
      });
    }
  }
  return out;
}

function isEndpoint(p, edge) {
  return pointsEqual(p, edge.a) || pointsEqual(p, edge.b);
}

function mergeAtomicEdges(atomic) {
  const merged = new Map();
  for (const e of atomic) {
    const key = edgeKey(e.a, e.b);
    let entry = merged.get(key);
    if (!entry) {
      // Keep the first-seen atomic edge orientation so all downstream
      // winding probes see one consistent directed edge.
      entry = { a: e.a, b: e.b, sources: [], key };
      merged.set(key, entry);
    }
    const sameDirection = pointKey(e.a) === pointKey(entry.a);
    const direction = sameDirection ? 1 : -1;
    // Winding jump weight is +1 across a material boundary for the retained
    // directed edge; direction records source traversal for cancellation only.
    entry.sources.push({ ...e.source, direction, sign: 1 });
  }
  return [...merged.values()];
}

export function pointKey(p) {
  return `${p.x.toString()}|${p.y.toString()}`;
}

export function edgeKey(a, b) {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
}
