import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("..", import.meta.url).pathname;
const artifactDir = join(root, "artifacts", "final");
mkdirSync(artifactDir, { recursive: true });

function findChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome"
  ];
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME || "", ".cache", "ms-playwright"),
    "/home/hj/.cache/ms-playwright",
    "/root/.cache/ms-playwright"
  ].filter(Boolean);
  for (const cache of cacheRoots) {
    if (existsSync(cache)) {
      for (const entry of readdirSync(cache).sort().reverse()) {
        if (!entry.startsWith("chromium-")) continue;
        candidates.push(
          join(cache, entry, "chrome-linux64", "chrome"),
          join(cache, entry, "chrome-linux", "chrome")
        );
      }
    }
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const port = 4183;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore"
});

let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  const executablePath = findChromium();
  if (!executablePath) throw new Error("No Chromium executable found.");

  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__contactDemoReady === true);

  const near = await page.evaluate(() => window.contactDemo.getProbe());
  expect(near.basis === 1, `Near shot should hit a depth gap, got ${near.basisName}`);
  expect(near.referenceOccluded, "Near shot geometry reference should be occluded");
  expect(near.steps > 0 && near.steps <= 63, `Near shot step count invalid: ${near.steps}`);
  expect(near.gap > 0 && near.gap < 0.14, `Near shot depth gap invalid: ${near.gap}`);

  await page.screenshot({ path: join(artifactDir, "near-beauty.png") });
  await page.evaluate(() => window.contactDemo.setView("steps"));
  await page.screenshot({ path: join(artifactDir, "near-steps.png") });
  await page.evaluate(() => window.contactDemo.setView("basis"));
  await page.screenshot({ path: join(artifactDir, "near-basis.png") });
  await page.evaluate(() => window.contactDemo.setView("reference"));
  await page.screenshot({ path: join(artifactDir, "near-reference.png") });
  await page.evaluate(() => window.contactDemo.setView("compare"));
  await page.screenshot({ path: join(artifactDir, "near-compare.png") });

  await page.evaluate(() => {
    window.contactDemo.setView("basis");
    window.contactDemo.setShot("edge");
  });
  const edge = await page.evaluate(() => window.contactDemo.getProbe());
  expect(edge.basis === 2, `Edge shot should report screen edge, got ${edge.basisName}`);
  await page.screenshot({ path: join(artifactDir, "edge-basis.png") });

  await page.evaluate(() => {
    window.contactDemo.setView("beauty");
    window.contactDemo.setShot("miss");
  });
  const miss = await page.evaluate(() => window.contactDemo.getProbe());
  expect(miss.basis === 3, `Miss shot should reach range end, got ${miss.basisName}`);
  expect(!miss.referenceOccluded, "Miss shot geometry reference should be clear");
  await page.screenshot({ path: join(artifactDir, "miss-beauty.png") });

  const report = {
    viewport: "1440x960",
    near,
    edge,
    miss,
    errors,
    generatedAt: new Date().toISOString()
  };
  writeFileSync(join(artifactDir, "verification.json"), JSON.stringify(report, null, 2));
  expect(errors.length === 0, `Browser console errors:\n${errors.join("\n")}`);
  console.log(JSON.stringify({ near, edge, miss, artifacts: artifactDir }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
