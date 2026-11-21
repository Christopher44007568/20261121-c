import { bakeMSDF } from '../src/baker.js';
import { parsePathData } from '../src/path-parser.js';
import { makeTransform, runDiff } from '../src/diff-harness.js';
const wedge = parsePathData('M-10,-12 L10,-12 L0.3,16 L0,17 L-0.3,16 Z', 0.03);
function tipClip(bake, tr, W, originY) {
  const r = runDiff(bake.oriented, bake, tr, { width: W, height: W, superSamples: 2, originX: W/2, originY });
  let tGT=W,tM=W,tS=W;
  for (let y=0;y<W;y++) for (let x=0;x<W;x++){const i=y*W+x;
    if(r.gt[i]>=.5)tGT=Math.min(tGT,y);
    if(r.msCov[i]>=.5)tM=Math.min(tM,y);
    if(r.sdfCov[i]>=.5)tS=Math.min(tS,y);}
  return { msdf: tM-tGT, sdf: tS-tGT };
}
for (const size of [24, 32, 48]) {
  const bake = bakeMSDF(wedge, { size, paddingEm: 3, distanceRangePx: 4 });
  for (const scale of [6, 10, 16]) {
    const W=360, originY=20+18*scale;
    const f = tipClip(bake, makeTransform({scale}), W, originY);
    const o = tipClip(bake, makeTransform({scale, skewX:0.8, skewY:0.25}), W, originY);
    console.log('tex',size,'scale',scale,'正面 MSDF/SDF',f.msdf,f.sdf,' 斜视 MSDF/SDF',o.msdf,o.sdf);
  }
}
