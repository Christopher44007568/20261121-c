// A boundary walk can revisit a vertex where two regions only touch (a pinch).
// Such a self-touching loop is weakly simple and cannot be ear-clipped, so we
// split it at every repeated vertex into independent simple loops.

import { pointKey } from "./arrangement.js";

export function splitSelfTouchingLoops(loops) {
  const out = [];
  for (const loop of loops) {
    const firstSeen = new Map();
    let current = [];
    for (const p of loop) {
      const key = pointKey(p);
      if (firstSeen.has(key)) {
        current.push(p);
        out.push(current);
        current = [p];
        firstSeen.clear();
        firstSeen.set(key, 0);
      } else {
        firstSeen.set(key, current.length);
        current.push(p);
      }
    }
    if (current.length >= 3) out.push(current);
  }
  return out.filter((loop) => loop.length >= 3 && new Set(loop.map(pointKey)).size >= 3);
}
