import assert from "node:assert/strict";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "artifacts");
const convergence = JSON.parse(await readFile(join(artifacts, "data", "convergence.json"), "utf8"));
const diagnostics = JSON.parse(await readFile(join(artifacts, "data", "diagnostics.json"), "utf8"));

assert.equal(convergence.cases.length, 3);
assert.deepEqual(convergence.cases.map((entry) => entry.id), ["sphere-plane", "edge-contact", "stacked-gap"]);
for (const entry of convergence.cases) {
  assert.equal(entry.referenceSamples, 512);
  assert.deepEqual(entry.series.map((series) => series.samples), [4, 8, 16, 32, 64, 128, 256, 512]);
  for (let i = 1; i < entry.series.length; i++) {
    assert.ok(entry.series[i].rmse <= entry.series[i - 1].rmse * 1.02, `${entry.id} convergence`);
  }
  const image = await readFile(join(artifacts, "reference", `${entry.id}-reference.png`));
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), 900);
  assert.equal(image.readUInt32BE(20), 650);
  assert.ok(diagnostics.cases[entry.id].stress.total > 0);
  for (const point of diagnostics.cases[entry.id].stress.points) {
    assert.equal(point.position.length, 3);
    assert.ok(Number.isFinite(point.referenceAO));
    assert.ok(point.referenceAO > point.ao);
  }
}
const convergenceSvg = await readFile(join(artifacts, "convergence.svg"), "utf8");
const distanceSvg = await readFile(join(artifacts, "distance-sweep.svg"), "utf8");
for (const id of ["sphere-plane", "edge-contact", "stacked-gap"]) {
  assert.ok(convergenceSvg.includes(id));
  assert.ok(distanceSvg.includes(id));
}
console.log("Data and reference images verified.");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1169/chrome-linux/chrome"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function waitFor(fn, timeout = 20000, interval = 250) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Timed out waiting for browser state");
}

async function browserSmoke() {
  const chrome = chromePath();
  if (!chrome) {
    console.log("Chromium not found; browser smoke test skipped.");
    return;
  }
  const serverPort = await freePort();
  const debugPort = await freePort();
  const profile = `/tmp/ao-bench-verify-${process.pid}`;
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(serverPort) },
    stdio: "ignore"
  });
  let browser;
  let socket;
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${serverPort}/`)).ok;
      } catch {
        return false;
      }
    });
    browser = spawn(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,900",
      `http://127.0.0.1:${serverPort}/`
    ], { stdio: "ignore" });

    const page = await waitFor(async () => {
      try {
        const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
        return pages.find((entry) => entry.type === "page" && entry.url.startsWith(`http://127.0.0.1:${serverPort}`));
      } catch {
        return null;
      }
    });
    socket = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();
    const exceptions = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method === "Runtime.exceptionThrown") {
        exceptions.push(message.params.exceptionDetails);
      }
    };
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      return response.result?.result?.value;
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await waitFor(async () => {
      const ready = await evaluate(`document.querySelectorAll('.case-card').length === 3 && document.querySelector('#status-pill')?.textContent === 'IDLE' && document.querySelector('#stat-ao')?.textContent !== '—'`);
      return ready;
    }, 30000);
    await evaluate(`document.querySelector('[data-scene="edge-contact"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await evaluate(`[...document.querySelectorAll('#mode-switch button')].find((button) => button.dataset.mode === 'lightmap').click()`);
    await waitFor(async () => {
      return await evaluate(`document.querySelector('#status-pill')?.textContent === 'IDLE' && document.querySelector('#viewport-badge')?.textContent.includes('光照贴图')`);
    }, 30000);
    assert.deepEqual(exceptions, []);
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const screenshotPath = join(artifacts, "screenshot-final.png");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(screenshotPath, Buffer.from(screenshot.result.data, "base64")));
    assert.ok((await stat(screenshotPath)).size > 30000);
    console.log("Browser smoke test passed; wrote artifacts/screenshot-final.png.");
  } finally {
    if (socket) socket.close();
    if (browser) {
      browser.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        browser.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

await browserSmoke();
