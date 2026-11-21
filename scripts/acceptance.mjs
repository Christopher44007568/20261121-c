import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const PORT = Number(process.env.ACCEPTANCE_PORT || 4387);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  "playwright",
  "/home/hj/userfeedback2/uid5-0016/node_modules/playwright/index.mjs",
].filter(Boolean);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
].filter(Boolean);

async function loadPlaywright() {
  let lastError;
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      return await import(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timed out.")), 10000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Viewer available")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => reject(new Error(chunk.toString())));
  });
}

function check(name, condition, detail) {
  return { name, pass: Boolean(condition), detail };
}

await mkdir("artifacts", { recursive: true });
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

let browser;
try {
  await waitForServer(server);
  const { chromium } = await loadPlaywright();
  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) throw new Error("No Chromium executable found.");

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--font-render-hinting=none",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      pageErrors.push(message.text());
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.viewerReady === "true", null, {
    timeout: 20000,
  });
  await page.evaluate(() => window.__viewer.waitForIdle(10));

  const initial = await page.evaluate(() => window.__viewer.getState());
  const initialProof = await page.evaluate(() => window.__viewer.getPixelProof());

  const zoomTrace = await page.evaluate(async () => {
    const radii = [34, 31.5, 28.5, 25.5, 29.9679172];
    const frames = await window.__viewer.runZoomTrace(radii);
    await window.__viewer.waitForIdle(16);
    const stableA = window.__viewer.getState();
    await window.__viewer.waitForIdle(12);
    const stableB = window.__viewer.getState();
    return { frames, stableA, stableB };
  });

  const identifier = (rect) => `${rect.x}:${rect.y}`;
  const shifts = [];
  for (let index = 1; index < zoomTrace.frames.length; index += 1) {
    if (!zoomTrace.frames[index].zooming) continue;
    const before = new Map(zoomTrace.frames[index - 1].labels.map((item) => [item.id, item.rect]));
    for (const label of zoomTrace.frames[index].labels) {
      const previous = before.get(label.id);
      if (previous) shifts.push(Math.hypot(label.rect.x - previous.x, label.rect.y - previous.y));
    }
  }
  const maxStepShift = shifts.length ? Math.max(...shifts) : 0;
  const stableA = zoomTrace.stableA;
  const stableB = zoomTrace.stableB;
  const idleStable =
    stableA.labels.length === stableB.labels.length &&
    stableA.labels.every((label, index) => identifier(label.rect) === identifier(stableB.labels[index].rect));
  const final = stableB;
  const finalProof = await page.evaluate(() => window.__viewer.getPixelProof());

  const distances = final.worldDistances;
  const whitespace = final.finalLabelWhitespace;
  const m1 = final.occlusion.byDimension.M1;
  const m2 = final.occlusion.byDimension.M2;
  const modelProof = Object.values(finalProof).every(
    (item) => item.hidden?.orange > 0 && item.hidden?.empty > 0 && item.visible?.coverage > 0.82,
  );
  const checks = [
    check("M1 world distance", Math.abs(distances.M1 - 14) < 1e-7, distances.M1),
    check("M2 world distance", Math.abs(distances.M2 - 1.8) < 1e-7, distances.M2),
    check("M1 has Z-hidden segments", m1.hiddenPx > 20 && m1.segments.length > 0, m1.hiddenPx),
    check("M2 has Z-hidden segments", m2.hiddenPx > 5 && m2.segments.length > 0, m2.hiddenPx),
    check("hidden runs are dashed", modelProof, finalProof),
    check("model clearance >= 12 CSS px", whitespace.minModelGapCss >= 12, whitespace.minModelGapCss),
    check("label gap >= 8 CSS px", whitespace.minLabelGapCss >= 8, whitespace.minLabelGapCss),
    check("viewport clearance >= 12 CSS px", whitespace.minViewportGapCss >= 12, whitespace.minViewportGapCss),
    check("zoom slot switches <= 1", final.zoom.slotSwitches <= 1, final.zoom.slotSwitches),
    check("zoom label shift <= 12 CSS px", maxStepShift <= 12, maxStepShift),
    check("idle label boxes stable", idleStable, idleStable),
    check("no page errors", pageErrors.length === 0, pageErrors),
  ];

  await page.screenshot({ path: "artifacts/acceptance-dpr2.png", animations: "disabled" });
  const report = {
    generatedAt: new Date().toISOString(),
    dpr: final.dpr,
    framebuffer: final.framebuffer,
    cssViewport: final.cssViewport,
    worldDistances: distances,
    labelWhitespace: initial.finalLabelWhitespace,
    finalLabelWhitespace: whitespace,
    occlusion: {
      hiddenPx: m1.hiddenPx + m2.hiddenPx,
      hiddenRatio: m1.hiddenRatio,
      segments: m1.segments,
      byDimension: final.occlusion.byDimension,
    },
    pixelProof: finalProof,
    zoom: {
      slotSwitches: final.zoom.slotSwitches,
      maxStepShiftCss: maxStepShift,
      maxStepShiftDevice: maxStepShift * final.dpr,
      finalDistance: final.zoom.finalDistance,
      idleBoxesStable: idleStable,
      framesObserved: zoomTrace.frames.length,
      motionFrames: zoomTrace.frames.filter((frame) => frame.zooming).length,
      requestedRadii: [34, 31.5, 28.5, 25.5, 29.9679172],
    },
    checks,
    passed: checks.every((item) => item.pass),
    screenshot: "artifacts/acceptance-dpr2.png",
  };
  await writeFile("artifacts/acceptance-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    passed: report.passed,
    worldDistances: report.worldDistances,
    finalLabelWhitespace: report.finalLabelWhitespace,
    occlusion: {
      M1: { hiddenPx: m1.hiddenPx, segments: m1.segments.length },
      M2: { hiddenPx: m2.hiddenPx, segments: m2.segments.length },
    },
    zoom: report.zoom,
    checks,
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
