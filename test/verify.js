'use strict';
// 按步复核：裁剪 -> 覆盖(top-left) -> 透视插值 -> 深度 -> 混合 -> 最终颜色
const assert = require('assert');
const { scene, CHECK_POINTS } = require('../src/scene');
const { render, edgeFunction, isTopLeft, perspectiveWeights } = require('../src/rasterizer');
const { clipTriangle } = require('../src/clip');
const { perspective, lookAt, transformPoint, m4mul } = require('../src/mat');

let passed = 0;
function check(name, cond, extra) {
  assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
  passed += 1;
  console.log('  ✓', name);
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

console.log('STEP 0 相机投影矩阵（世界 -> 齐次裁剪）');
{
  const proj = perspective(Math.PI / 2, 16 / 10, 0.1, 100);
  const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const mvp = m4mul(proj, view);
  // 相机空间原点 (0,0,0) 位于 eye 前方 5 单位，投影后应落在 NDC 原点
  const center = transformPoint(mvp, [0, 0, 0]);
  check('世界原点投影到 NDC (0,0)', approx(center[0] / center[3], 0, 1e-9) && approx(center[1] / center[3], 0, 1e-9));
  // 透视矩阵保持 w = -z_view（这里 z_view = -5）
  check('透视除法 w 与视距一致', approx(center[3], 5, 1e-9), { w: center[3] });
}

const res = render(scene, { tracePoints: CHECK_POINTS.map((p) => p.pixel) });
const byId = Object.fromEntries(res.traces.map((t, i) => [CHECK_POINTS[i].id, t]));

console.log('STEP 1 齐次裁剪');
{
  const t4 = scene.triangles[4];
  const r = clipTriangle(t4.vertices, [scene.width, scene.height]);
  check('T4 被裁剪成多边形（顶点数 > 3）', r.polygonSize > 3, { n: r.polygonSize });
  check('T4 命中 near 平面', r.planesHit.includes('near'));
  check('未跨面的三角形无平面命中', clipTriangle(scene.triangles[0].vertices, [scene.width, scene.height]).planesHit.length === 0);
  check('全部裁剪后顶点 w > 0', r.triangles.flat().every((v) => v.pos[3] > 0));
  const stats = res.stats;
  check('stats.clipped 统计为 1', stats.clipped === 1, stats);
}

console.log('STEP 2 top-left 覆盖规则（共享边）');
{
  const edge = byId.edge;
  const t0 = edge.attempts.find((a) => a.triangleId === 'T0');
  const t1 = edge.attempts.find((a) => a.triangleId === 'T1');
  check('T0 覆盖共享边像素', t0.covered === true);
  check('T1 排除共享边像素', t1.covered === false);
  check('T1 排除原因为 edge（而非 outside）', t1.reason === 'edge', { reason: t1.reason });
  const zeroEdgeT0 = t0.edges.find((e) => approx(e.value, 0, 1e-6));
  const zeroEdgeT1 = t1.edges.find((e) => approx(e.value, 0, 1e-6));
  check('T0 零边是 top-left 且被接受', zeroEdgeT0 && zeroEdgeT0.topLeft && zeroEdgeT0.accepted);
  check('T1 零边非 top-left 且被拒绝', zeroEdgeT1 && !zeroEdgeT1.topLeft && !zeroEdgeT1.accepted);
}

console.log('STEP 3 透视正确插值');
{
  const near = byId.near;
  const ev = near.events[0];
  check('T4 产生着色事件', ev && ev.triangleId === 'T4');
  const sumBary = ev.screenBarycentric.reduce((a, b) => a + b, 0);
  const sumW = ev.perspectiveWeights.reduce((a, b) => a + b, 0);
  check('屏幕重心和为 1', approx(sumBary, 1, 1e-12), { sumBary });
  check('透视权重和为 1', approx(sumW, 1, 1e-12), { sumW });
  check('裁剪后 inverseW 不等于 1（存在透视）', ev.inverseW !== 1, { invW: ev.inverseW });
  // w=1 三角形：透视权重应等于屏幕重心
  const edgeEv = byId.edge.events[0];
  check('w=1 时透视权重≈屏幕重心',
    edgeEv.perspectiveWeights.every((w, i) => approx(w, edgeEv.screenBarycentric[i], 1e-12)));
}

console.log('STEP 4 深度测试（LESS）');
{
  const equal = byId.equal;
  const [e2, e3] = equal.events;
  check('T2 先绘制且通过', e2.triangleId === 'T2' && e2.depth.pass === true);
  check('T3 等深被 LESS 拒绝', e3.triangleId === 'T3' && e3.depth.pass === false);
  check('T3 未触发混合', e3.blended === false);
  check('窗口深度 = ndc*0.5+0.5', approx(e2.depth.window, e2.depth.ndc * 0.5 + 0.5, 1e-12));
  check('T3 测试前深度缓冲已为 T2 的值', approx(e3.depth.previous, e2.depth.window, 1e-12));
}

console.log('STEP 5 Alpha 混合与最终颜色');
{
  const blend = byId.blend;
  const [e0, e5] = blend.events;
  check('T0 先写入不透明色', e0.blended && e0.alpha === 1);
  check('T5 半透明通过深度并混合', e5.blended && approx(e5.alpha, 0.62, 1e-12));
  const a = 0.62;
  const expect = e5.interpolatedColor.map((s, i) => s * a + e5.previousColor[i] * (1 - a));
  check('混合公式 src*a + dst*(1-a)（8bit 取整）', expect.every((v, i) => approx(v, e5.result[i], 1.01)),
    { expect, got: e5.result });
  check('Alpha 不写回（保持 255）', e5.result[3] === 255);
  check('最终颜色与帧缓冲一致', JSON.stringify(blend.final) === JSON.stringify(e5.result));
}

console.log('STEP 6 全部复核点事件链完整');
{
  for (const id of ['edge', 'near', 'equal', 'blend']) {
    const tr = byId[id];
    check(`${id} 记录全部 6 个三角形的尝试`, tr.attempts.length === 6, { n: tr.attempts.length });
    check(`${id} 至少一个着色事件`, tr.events.length >= 1);
  }
}

console.log(`\n全部通过：${passed} 项断言`);
console.log('stats', JSON.stringify(res.stats));
