import { bakeMSDF } from '../src/baker.js';
import { parsePathData } from '../src/path-parser.js';
import { makeTransform, sampleTexture } from '../src/diff-harness.js';
import { insideAt, pointSegmentDistance2 } from '../src/geometry.js';

// Measure signed field value AT analytic boundary points after the transform.
// A perfect field gives ~0. RMS of these measures boundary placement error.
function boundaryError(shape, bake, transform, n = 400) {
  let segs = bake.segments;
  let sumM = 0, sumS = 0, maxM = 0, maxS = 0, cnt = 0;
  for (const seg of segs) {
    const steps = Math.max(2, Math.ceil(n / segs.length));
    for (let k = 0; k <= steps; k++) {
      const t = (k + 0.5) / (steps + 1);
      const em = { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
      const dm = sampleTexture(bake, em, 'msdf');
      const ds = sampleTexture(bake, em, 'sdf');
      if (dm == null || ds == null) continue;
      // convert EM distance error to screen px
      const px = Math.hypot(transform.a, transform.c);
      const eM = Math.abs(dm) * px, eS = Math.abs(ds) * px;
      sumM += eM * eM; sumS += eS * eS; maxM = Math.max(maxM, eM); maxS = Math.max(maxS, eS); cnt++;
    }
  }
  return { msdfRMS: Math.sqrt(sumM/cnt), sdfRMS: Math.sqrt(sumS/cnt), msdfMax: maxM, sdfMax: maxS };
}

const wedge = parsePathData('M-10,-12 L10,-12 L0.3,16 L0,17 L-0.3,16 Z', 0.03);
for (const size of [20, 32, 48]) {
  const bake = bakeMSDF(wedge, { size, paddingEm: 3, distanceRangePx: 4 });
  for (const [name, tr] of [['正面', makeTransform({scale:42})], ['斜视', makeTransform({scale:42,skewX:0.75,skewY:0.2})]]) {
    const e = boundaryError(bake.oriented, bake, tr);
    console.log('tex', size, name, 'MSDF RMS/max', e.msdfRMS.toFixed(3), e.msdfMax.toFixed(3), 'SDF RMS/max', e.sdfRMS.toFixed(3), e.sdfMax.toFixed(3));
  }
}
