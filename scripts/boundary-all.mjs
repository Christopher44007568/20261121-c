import { bakeMSDF } from '../src/baker.js';
import { parsePathData } from '../src/path-parser.js';
import { makeTransform, boundaryAccuracy } from '../src/diff-harness.js';
import { SAMPLE_GLYPHS } from '../web/sample-glyphs.js';
for (const g of SAMPLE_GLYPHS) {
  const shape = parsePathData(g.path, 0.03);
  const bake = bakeMSDF(shape, { size: 48, paddingEm: 4, distanceRangePx: 4 });
  for (const [name, tr] of [['正面', makeTransform({scale:30})], ['斜视', makeTransform({scale:30,skewX:0.7,skewY:0.15})]]) {
    const b = boundaryAccuracy(bake.oriented, bake, tr);
    console.log(g.id.padEnd(11), name, 'RMS MSDF/SDF', b.msdfRms.toFixed(3).padStart(7), b.sdfRms.toFixed(3).padStart(7),
      '倍数', (b.sdfRms/Math.max(1e-6,b.msdfRms)).toFixed(2) + 'x');
  }
}
