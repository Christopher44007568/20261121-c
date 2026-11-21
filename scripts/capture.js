import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('.');
const artifacts = resolve('artifacts');

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function startServer(port) {
  const child = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`server timeout: ${output}`)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('terra-local viewer')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      rejectReady(new Error(`server exited ${code}: ${output}`));
    });
  });
  await ready;
  return child;
}

async function screenshot(page, name) {
  await page.waitForTimeout(220);
  await page.screenshot({ path: resolve(artifacts, name) });
  console.log(`captured artifacts/${name}`);
}

await mkdir(artifacts, { recursive: true });
const port = await freePort();
const server = await startServer(port);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__TERRA__?.ready === true);

  await page.evaluate(() => window.__TERRA__.jumpToSite('overview'));
  await screenshot(page, 'overview.png');

  await page.evaluate(() => window.__TERRA__.jumpToSite('bund', 0.62));
  await screenshot(page, 'first-light.png');

  const selfTests = {};
  for (const site of ['bund', 'lujiazui']) {
    await page.evaluate((siteId) => window.__TERRA__.jumpToSite(siteId, 0.62), site);
    await page.waitForTimeout(120);
    selfTests[site] = await page.evaluate(() => window.__TERRA__.runSelfTest());
  }
  for (const site of ['bund', 'lujiazui']) {
    const result = selfTests[site];
    assert.equal(result.rtc.matchRate, 1, `${site} RTC color-ID mismatch`);
    assert.equal(result.hilo.matchRate, 1, `${site} HI/LO color-ID mismatch`);
  }

  await page.evaluate(() => window.__TERRA__.jumpToSite('bund', 1.42));
  await screenshot(page, 'close-markers.png');

  await page.evaluate(() => {
    window.__TERRA__.jumpToSite('bund', 0.62);
    window.__TERRA__.setMode('hilo');
  });
  await screenshot(page, 'hilo-close.png');
  await page.evaluate(() => window.__TERRA__.setMode('rtc'));

  await page.evaluate(() => {
    window.__TERRA__.jumpToSite('bund', 0.62);
  });
  await page.waitForTimeout(120);
  const a05 = await page.evaluate(() => window.__TERRA__.screenForMarker('A-05'));
  await page.mouse.click(a05.x, a05.y);
  await page.waitForTimeout(180);
  const clickSelection = await page.evaluate(() => window.__TERRA__.getState().selectedId);
  assert.equal(clickSelection, 'A-05', 'pointer click did not pick A-05');
  const picked = await page.evaluate(() => {
    const point = window.__TERRA__.screenForMarker('A-05');
    return window.__TERRA__.pickAt(point.x, point.y);
  });
  assert.equal(picked.gpu.id, 'A-05');
  assert.equal(picked.ray.id, 'A-05');
  assert.equal(picked.match, true);
  await screenshot(page, 'picked-marker.png');

  await page.evaluate(() => window.__TERRA__.jumpToSite('lujiazui', 0.62));
  await screenshot(page, 'lujiazui.png');

  await page.evaluate(() => {
    window.__TERRA__.jumpToSite('bund', 0.62);
    window.__TERRA__.setDiagnostics(true);
  });
  await screenshot(page, 'precision-diagnostics.png');
  await page.evaluate(() => window.__TERRA__.setDiagnostics(false));

  const before = await page.evaluate(() => {
    window.__TERRA__.setTourTime(7.7);
    window.__TERRA__.play();
    return window.__TERRA__.getState().camera.eye;
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.__TERRA__.getState().camera.eye);
  assert.ok(Math.hypot(
    before[0] - after[0],
    before[1] - after[1],
    before[2] - after[2],
  ) > 0.001, 'auto tour did not advance the camera');

  const distributionPath = resolve(artifacts, 'projection-error-distribution.json');
  const distribution = JSON.parse(await readFile(distributionPath, 'utf8'));
  const total = (mode) => ({
    samples: selfTests.bund[mode].samples + selfTests.lujiazui[mode].samples,
    matches: selfTests.bund[mode].matches + selfTests.lujiazui[mode].matches,
  });
  for (const mode of ['rtc', 'hilo']) {
    const result = total(mode);
    distribution.picking[mode].renderPathMatches = result.matches;
    distribution.picking[mode].renderPathSamples = result.samples;
    distribution.picking[mode].renderPathMatchRate = result.matches / result.samples;
  }
  distribution.picking.browserVerification = {
    renderer: 'Chromium headless / WebGL2 color-ID framebuffer',
    viewport: '1440x900 @ 1x',
    modes: ['rtc', 'hilo'],
    sites: ['bund', 'lujiazui'],
    at: new Date().toISOString(),
  };
  await writeFile(distributionPath, `${JSON.stringify(distribution, null, 2)}\n`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__TERRA__?.ready === true);
  await page.evaluate(() => {
    window.__TERRA__.jumpToSite('bund', 0.62);
    window.__TERRA__.setDiagnostics(true);
  });
  await screenshot(page, 'projection-error-panel.png');

  const verification = {
    schema: 'terra-local/browser-verification@1',
    at: new Date().toISOString(),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    selfTests,
    picked,
    pointerClickSelection: clickSelection,
    autoTourAdvanced: true,
    consoleErrors,
  };
  await writeFile(
    resolve(artifacts, 'browser-verification.json'),
    `${JSON.stringify(verification, null, 2)}\n`,
  );
  assert.deepEqual(consoleErrors, []);
  console.log('browser verification passed');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
