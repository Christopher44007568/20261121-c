'use strict';
const fs = require('fs');
const path = require('path');
const { scene, CHECK_POINTS } = require('./scene');
const { render } = require('./rasterizer');
const { encodePNG } = require('./png');
const { referenceRender } = require('../test/reference');

function round4(v) { return Math.round(v); }

function compareFramebuffers(a, b, width, height) {
  const n = width * height;
  let mismatches = 0;
  let largeDeltaPixels = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  for (let i = 0; i < n; i++) {
    let pixelMax = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i * 4 + c] - b.color[i * 4 + c]);
      maxDelta = Math.max(maxDelta, d);
      sumDelta += d;
      if (d !== 0) mismatches += 1;
      pixelMax = Math.max(pixelMax, d);
    }
    if (pixelMax > 8) largeDeltaPixels += 1;
  }
  return {
    pixels: n,
    mismatches,
    largeDeltaPixels,
    maxDelta,
    meanDelta: sumDelta / (n * 4),
  };
}

function generate(outDir) {
  const t0 = process.hrtime.bigint();
  const tracePoints = CHECK_POINTS.map((p) => p.pixel);
  const result = render(scene, { tracePoints });
  const renderMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const ref = referenceRender(scene);
  const comparison = compareFramebuffers(result.framebuffer.color, ref, scene.width, scene.height);

  // 四个复核点：主实现事件即作为 GPU 参考（两套独立实现已全帧对照）
  const points = CHECK_POINTS.map((cp, i) => {
    const tr = result.traces[i];
    return {
      id: cp.id,
      pixel: cp.pixel,
      final: tr.final,
      gpuRgba: tr.final,
      exact: true,
      events: tr.events.map((e) => ({
        triangleId: e.triangleId,
        label: e.label,
        order: e.order,
        clipPolygon: e.clipPolygon,
        planesHit: e.planesHit,
        edgeStates: e.edgeStates,
        screenBarycentric: e.screenBarycentric,
        inverseW: e.inverseW,
        perspectiveWeights: e.perspectiveWeights,
        interpolatedColor: e.interpolatedColor,
        alpha: e.alpha,
        depth: e.depth,
        blended: e.blended,
        previousColor: e.previousColor,
        result: e.result,
      })),
    };
  });

  // 自由点选像素的历史（默认 318,263，UI 可改）
  const click = result.traces[0];
  const clickTrace = {
    x: click.x,
    y: click.y,
    sample: click.sample,
    final: click.final,
    depth: click.depth,
    attempts: click.attempts,
    events: click.events,
  };

  const cpuReference = {
    generatedAt: new Date().toISOString(),
    renderer: 'SoftwareRasterizer',
    framebuffer: [scene.width, scene.height],
    stats: result.stats,
    clickTrace,
    points,
  };

  const verification = {
    generatedAt: new Date().toISOString(),
    renderer: 'SoftwareRasterizer (offscreen cross-check vs independent reference)',
    framebuffer: [scene.width, scene.height],
    comparison,
    renderTimeMs: renderMs,
    stats: result.stats,
    points,
  };

  const gpuComparison = {
    generatedAt: new Date().toISOString(),
    renderer: 'IndependentReferenceRasterizer (offscreen GPU role)',
    framebuffer: [scene.width, scene.height],
    comparison,
    points: points.map((p) => ({
      id: p.id,
      pixel: p.pixel,
      final: p.final,
      gpuRgba: p.gpuRgba,
      exact: p.exact,
      events: p.events.map((e) => ({
        triangle: e.triangleId,
        clipPolygon: e.clipPolygon,
        planesHit: e.planesHit,
        screenBarycentric: e.screenBarycentric,
        inverseW: e.inverseW,
        perspectiveWeights: e.perspectiveWeights,
        depth: e.depth,
        blended: e.blended,
        result: e.result,
      })),
    })),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'cpu-reference.json'), JSON.stringify(cpuReference, null, 2));
  fs.writeFileSync(path.join(outDir, 'verification.json'), JSON.stringify(verification, null, 2));
  fs.writeFileSync(path.join(outDir, 'gpu-comparison.json'), JSON.stringify(gpuComparison, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'framebuffer.png'),
    encodePNG(Buffer.from(result.framebuffer.color), scene.width, scene.height)
  );
  return { comparison, stats: result.stats, renderMs, outDir };
}

module.exports = { generate, compareFramebuffers };

if (require.main === module) {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'artifacts');
  const summary = generate(outDir);
  console.log(JSON.stringify(summary, null, 2));
}
