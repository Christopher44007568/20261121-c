'use strict';
// 真实离屏 GPU 对照：启动无头 Chromium，WebGL 渲染 vs 软件光栅化
const path = require('path');
const fs = require('fs');
const http = require('http');

function startServer(root) {
  const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const file = path.join(root, url === '/' ? 'test/gpu-harness.html' : url);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('/tmp/pwtest/node_modules/playwright'));
  } catch (e) {
    console.log('SKIP: 未安装 Playwright（', e.message, '）');
    process.exit(0);
  }
  const root = path.join(__dirname, '..');
  const server = await startServer(root);
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/test/gpu-harness.html`);
  await page.waitForFunction('window.__ready === true');
  const report = await page.evaluate('window.__runGPU()');
  await browser.close();
  server.close();
  if (errors.length) { console.error('页面错误:', errors); process.exit(1); }

  const outDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  report.generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'gpu-comparison.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ renderer: report.renderer, comparison: report.comparison,
    points: report.points.map((p) => ({ id: p.id, exact: p.exact })) }, null, 2));

  const { maxDelta, largeDeltaPixels, pixels, meanDelta } = report.comparison;
  const allExact = report.points.every((p) => p.exact);
  // 验收：四个边界复核点逐像素精确；全帧大差异（覆盖分歧）占比 < 0.01%，
  // 平均色差 < 0.01 色阶。残余亚像素差异源于 GPU 定点子像素精度，属预期范围。
  const coverageRate = largeDeltaPixels / pixels;
  const ok = allExact && coverageRate < 0.0001 && meanDelta < 0.01;
  console.log(`覆盖分歧率 ${(coverageRate * 100).toFixed(4)}% · 平均Δ ${meanDelta.toFixed(5)} · 复核点全精确 ${allExact}`);
  if (!ok) {
    console.error('GPU 对照超出容差');
    process.exit(1);
  }
  console.log('✓ 软件光栅化与真实 WebGL GPU 离屏结果在容差内一致');
}
main().catch((e) => { console.error(e); process.exit(1); });
