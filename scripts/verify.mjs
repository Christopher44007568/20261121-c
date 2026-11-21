import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const port = Number(process.env.VERIFY_PORT || 4283);
const executable = await findChromium();
if (!executable) {
  console.error("No Chromium executable found. Set CHROME_PATH to run browser verification.");
  process.exit(1);
}

const server = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve) => setTimeout(resolve, 400));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: executable,
    args: [
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,WebGPU",
      "--use-angle=vulkan",
      "--use-vulkan=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist"
    ]
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const messages = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

  await mkdir("artifacts", { recursive: true });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__viewerReady === true, { timeout: 15000 });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: "artifacts/overview.png", fullPage: true });

  const initial = await page.evaluate(() => window.__penumbra.getDiagnostics());
  const widths = initial.measurement.map((entry) => entry.width);
  const monotonic = widths.every((width, index) => index === 0 || width > widths[index - 1]);

  await page.click("#runSweep");
  await page.waitForFunction(() => !document.querySelector("#runSweep").classList.contains("busy"), { timeout: 10000 });
  await page.waitForTimeout(150);
  const sweep = await page.evaluate(() => window.__penumbra.getDiagnostics().sweep);

  await page.click("#computeReference");
  await page.waitForFunction(() => document.querySelector("#refState").textContent === "READY", { timeout: 45000 });
  await page.click('[data-view="split"]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "artifacts/reference-split.png", fullPage: true });
  const referenceValid = await page.evaluate(() => window.__penumbra.getDiagnostics().referenceValid);

  await page.click("#cameraCut");
  await page.waitForTimeout(650);
  const guarded = await page.evaluate(() => window.__penumbra.getDiagnostics());

  await page.click(".switch-row");
  await page.click("#cameraCut");
  await page.waitForTimeout(650);
  const unguarded = await page.evaluate(() => window.__penumbra.getDiagnostics());
  await page.screenshot({ path: "artifacts/history-cut.png", fullPage: true });

  const checks = {
    webgpuActive: initial.gpu?.includes("WEBGPU"),
    noRuntimeMessages: messages.length === 0,
    fiveProbes: widths.length === 5 && widths.every(Number.isFinite),
    penumbraMonotonic: monotonic,
    lightSlopePositive: sweep?.lightSlope > 0.05,
    gapSlopePositive: sweep?.gapSlope > 0.05,
    referenceReady: referenceValid === true,
    cameraCutPurged: guarded.cutCount >= 1 && guarded.staleHistory === false,
    staleHistoryDetected: unguarded.staleHistory === true && unguarded.cutCount >= 2,
    cutAngleMeasured: unguarded.lastCutAngle > 20
  };
  const report = {
    executable,
    checks,
    messages,
    initial: { ...initial, measurement: initial.measurement.map(({ values, ...rest }) => rest) },
    sweep,
    guarded,
    unguarded
  };
  await writeFile("artifacts/browser-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(checks, null, 2));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

async function findChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const roots = [
    join(process.env.HOME || "", ".cache", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(userInfo().homedir, ".cache", "ms-playwright")
  ];
  for (const root of [...new Set(roots)]) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries.sort().reverse()) {
        if (!entry.isDirectory() || !entry.name.startsWith("chromium")) continue;
        candidates.push(join(root, entry.name, "chrome-linux64", "chrome"));
        candidates.push(join(root, entry.name, "chrome-linux", "chrome"));
        candidates.push(join(root, entry.name, "chrome-linux", "headless_shell"));
      }
    } catch {
      // Keep checking the other known locations.
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not executable, continue.
    }
  }
  return null;
}
