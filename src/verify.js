import { lookAt, multiply, perspective } from "./math.js";
import { cameraPose, PROXY_TRIANGLES } from "./scene.js";
import { classify, evaluateFrame, LOD_BAND, MODE } from "./lod.js";

// Deterministic forward/reverse traversal over the same sloped camera path.
// LOD is a pure function of pose, so the two passes must agree exactly.
export function runReverseCheck({ trees, viewportH, fovy, aspect, meshTris }) {
  const stations = 97;
  const zStart = -105;
  const zEnd = 115;
  const zs = [];
  for (let i = 0; i < stations; i++) {
    zs.push(zStart + ((zEnd - zStart) * i) / (stations - 1));
  }

  const evalAt = (z) => {
    const proj = perspective(fovy, aspect, 0.5, 600);
    const { eye, look } = cameraPose(z);
    const vp = multiply(proj, lookAt(eye, look, [0, 1, 0]));
    return evaluateFrame(trees, vp, viewportH, MODE.AUTO, eye);
  };

  const forward = zs.map(evalAt);
  const reverse = [...zs].reverse().map(evalAt).reverse();

  let maxWeightErr = 0;
  let sumWeightErr = 0;
  let comparisons = 0;
  let repMismatch = 0;
  let triDrift = 0;
  let flips = 0;
  let meanWeight = 0;
  let weightSamples = 0;

  const triLoad = (ev) => {
    let t = 0;
    for (const r of ev.records) {
      if (r.weight > 0.001) t += meshTris;
      if (r.weight < 0.999) t += PROXY_TRIANGLES;
    }
    return t;
  };

  for (let s = 0; s < stations; s++) {
    const a = new Map(forward[s].records.map((r) => [r.treeId, r]));
    const b = new Map(reverse[s].records.map((r) => [r.treeId, r]));
    const ids = new Set([...a.keys(), ...b.keys()]);
    for (const id of ids) {
      const ra = a.get(id);
      const rb = b.get(id);
      if (!ra || !rb) { repMismatch++; continue; }
      const err = Math.abs(ra.weight - rb.weight);
      maxWeightErr = Math.max(maxWeightErr, err);
      sumWeightErr += err;
      comparisons++;
      meanWeight += ra.weight;
      weightSamples++;
      if (classify(ra.weight) !== classify(rb.weight)) repMismatch++;
    }
    triDrift = Math.max(triDrift, Math.abs(triLoad(forward[s]) - triLoad(reverse[s])));
  }

  // Fast threshold reversal: adjacent stations leap over the whole fade band.
  const countFlips = (seq) => {
    let n = 0;
    for (let s = 1; s < seq.length; s++) {
      const prev = new Map(seq[s - 1].records.map((r) => [r.treeId, r]));
      for (const cur of seq[s].records) {
        const older = prev.get(cur.treeId);
        if (!older) continue;
        const w0 = older.weight;
        const w1 = cur.weight;
        if (Math.abs(w1 - w0) > 0.9) n++;
      }
    }
    return n;
  };
  flips = countFlips(forward) + countFlips(reverse);

  const pass =
    maxWeightErr < 1e-9 &&
    triDrift === 0 &&
    repMismatch === 0 &&
    flips === 0;

  return {
    pass,
    stations,
    stationTotal: comparisons,
    weightErr: maxWeightErr,
    meanWeight: meanWeight / weightSamples,
    triDrift,
    repMismatch,
    flips,
    z: zs[Math.floor(stations / 2)],
    band: LOD_BAND,
  };
}
