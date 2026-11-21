'use strict';
// 全帧缓冲对照：主光栅化器 vs 独立参考实现（离屏 GPU 角色）
const { scene } = require('../src/scene');
const { render } = require('../src/rasterizer');
const { referenceRender } = require('./reference');

const main = render(scene).framebuffer;
const ref = referenceRender(scene);

let mismatches = 0;
let maxDelta = 0;
let sumDelta = 0;
const n = scene.width * scene.height;
for (let i = 0; i < n * 4; i++) {
  const d = Math.abs(main.color[i] - ref.color[i]);
  if (d !== 0) mismatches += 1;
  maxDelta = Math.max(maxDelta, d);
  sumDelta += d;
}
let depthDiff = 0;
for (let i = 0; i < n; i++) depthDiff = Math.max(depthDiff, Math.abs(main.depth[i] - ref.depth[i]));

const result = {
  framebuffer: [scene.width, scene.height],
  pixels: n,
  channelMismatches: mismatches,
  maxDelta,
  meanDelta: sumDelta / (n * 4),
  maxDepthDelta: depthDiff,
};
console.log(JSON.stringify(result, null, 2));
if (maxDelta > 1 || depthDiff > 1e-9) {
  console.error('对照失败：主实现与参考实现存在显著差异');
  process.exit(1);
}
console.log('✓ 全帧缓冲与独立参考实现一致（容差 1 个 8bit 色阶）');
