// 浏览器 ESM 内核 vs Node CommonJS 引擎：全帧缓冲 + 追踪事件一致性
import { render as webRender } from '../web/raster-core.mjs';
import { scene as webScene, CHECK_POINTS as webCP } from '../web/scene.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { render: nodeRender } = require('../src/rasterizer.js');
const { scene: nodeScene, CHECK_POINTS: nodeCP } = require('../src/scene.js');
import assert from 'node:assert';

const pts = nodeCP.map((p) => p.pixel);
const web = webRender(webScene, pts);
const node = nodeRender(nodeScene, { tracePoints: pts });

let colorDiff = 0, depthDiff = 0;
for (let i = 0; i < nodeScene.width * nodeScene.height; i++) {
  colorDiff = Math.max(colorDiff, Math.abs(web.color[i] - node.framebuffer.color[i]));
  depthDiff = Math.max(depthDiff, Math.abs(web.depth[i] - node.framebuffer.depth[i]));
}
console.log('color maxDelta', colorDiff, 'depth maxDelta', depthDiff);
assert.ok(colorDiff <= 1 && depthDiff < 1e-12, '帧缓冲不一致');

assert.equal(web.traces.length, node.traces.length);
web.traces.forEach((wt, i) => {
  const nt = node.traces[i];
  assert.equal(wt.attempts.length, nt.attempts.length, `${nodeCP[i].id} 尝试数`);
  assert.deepEqual(JSON.parse(JSON.stringify(wt.final)), nt.final, `${nodeCP[i].id} 最终色`);
  wt.attempts.forEach((a, j) => {
    assert.equal(a.covered, nt.attempts[j].covered, `${nodeCP[i].id} 覆盖`);
    assert.equal(a.reason, nt.attempts[j].reason, `${nodeCP[i].id} 原因`);
  });
  assert.equal(wt.events.length, nt.events.length, `${nodeCP[i].id} 事件数`);
});
console.log('✓ 浏览器内核与 Node 引擎在', pts.length, '个复核点上完全一致');
console.log('stats', JSON.stringify(web.stats));
