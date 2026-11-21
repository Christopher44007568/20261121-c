import { bakeMSDF } from '../src/baker.js';
import { parsePathData, parseOutlineJson } from '../src/path-parser.js';
import { makeTransform, runDiff, buildHeatmap, boundaryAccuracy } from '../src/diff-harness.js';
import { SAMPLE_GLYPHS, JSON_EXAMPLE } from '../web/sample-glyphs.js';

for (const g of SAMPLE_GLYPHS) {
  const shape = parsePathData(g.path, 0.03);
  const bake = bakeMSDF(shape, { size: 64, paddingEm: 4, distanceRangePx: 4 });
  const tr = makeTransform({ scale: 26, skewX: 0.7, skewY: 0.15 });
  const r = runDiff(bake.oriented, bake, tr, { width: 120, height: 120, superSamples: 2 });
  const heat = buildHeatmap(r, 'hard');
  const b = boundaryAccuracy(bake.oriented, bake, tr);
  console.log(g.id.padEnd(11), 'tex', bake.size, 'corrected', String(bake.corrected).padStart(3),
    'heat bytes', heat.length, 'boundary RMS MSDF/SDF', b.msdfRms.toFixed(3), b.sdfRms.toFixed(3));
}
// JSON import path
const custom = parseOutlineJson(JSON_EXAMPLE);
const bake2 = bakeMSDF(custom, { size: 40 });
console.log('custom JSON contours', custom.contours.length, 'baked', bake2.data.length, 'bytes');
console.log('ALL E2E OK');
