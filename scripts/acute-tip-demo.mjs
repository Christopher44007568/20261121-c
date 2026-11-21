// Demonstrates the headline MSDF advantage on an acute spike: monochrome SDF
// clips the tip while the multi-channel median keeps it. Run with node.
import { bakeMSDF } from '../src/baker.js';
import { parsePathData } from '../src/path-parser.js';
import { makeTransform, tipClipping } from '../src/diff-harness.js';

const spike = parsePathData('M-10,-12 L10,-12 L0.3,16 L0,17 L-0.3,16 Z');
const bake = bakeMSDF(spike, { size: 32, paddingEm: 3, distanceRangePx: 4 });

const scale = 10;
const viewport = 360;
const originY = 20 + 18 * scale;

for (const [name, tr] of [
  ['正面', makeTransform({ scale })],
  ['斜视', makeTransform({ scale, skewX: 0.8, skewY: 0.25 })],
]) {
  const clip = tipClipping(bake.oriented, bake, tr, viewport, originY);
  console.log(
    name,
    '尖端削顶屏幕像素  MSDF=' + String(clip.msdfClip).padStart(4),
    '单通道SDF=' + String(clip.sdfClip).padStart(4)
  );
}
