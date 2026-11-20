import { chromium } from "playwright";
import { existsSync } from "node:fs";

const executablePath = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1169/chrome-linux/chrome`,
  "/home/hj/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const messages = [];
page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const diagnosticsBefore = await page.evaluate(() => window.spectra?.getDiagnostics());
const registry = await page.evaluate(() => window.spectra?.getRegistry());
const viewport = await page.evaluate(() => window.spectra?.viewer.getViewportState());

await page.screenshot({ path: "artifacts/viewer-default.png", fullPage: true });

const stageBox = await page.locator("#stage").boundingBox();
await page.mouse.move(stageBox.x + stageBox.width * 0.24, stageBox.y + stageBox.height * 0.15);
await page.mouse.down();
await page.mouse.move(stageBox.x + stageBox.width * 0.79, stageBox.y + stageBox.height * 0.85, {
  steps: 12,
});
await page.mouse.up();
await page.waitForFunction(
  () => document.querySelector("#selectionStatus")?.textContent === "VERIFIED",
  null,
  { timeout: 15000 },
);
const result = await page.evaluate(() => window.spectra.getSelection());
if (!result || result.stale || result.verifiedCount !== result.hitCount || result.hitCount < 20) {
  throw new Error(`ID selection failed: ${JSON.stringify(result)}`);
}
await page.waitForTimeout(500);
await page.screenshot({ path: "artifacts/viewer-selected.png", fullPage: true });

const replay = await page.evaluate(async () => {
  const [action] = window.spectra.getActions();
  return window.spectra.replayAction(action.actionId);
});
if (!replay || replay.stale || !replay.allVerified) {
  throw new Error(`Replay failed: ${JSON.stringify(replay)}`);
}
await page.waitForTimeout(500);

await page.setViewportSize({ width: 1100, height: 760 });
await page.waitForTimeout(500);
await page.screenshot({ path: "artifacts/viewer-resized.png", fullPage: true });
const resizedSelection = await page.evaluate(async () => {
  const viewport = window.spectra.viewer.getViewportState();
  return window.spectra.selectRect({
    x: viewport.cssWidth * 0.18,
    y: viewport.cssHeight * 0.2,
    width: viewport.cssWidth * 0.5,
    height: viewport.cssHeight * 0.55,
  });
});
if (
  !resizedSelection ||
  resizedSelection.stale ||
  resizedSelection.verifiedCount !== resizedSelection.hitCount
) {
  throw new Error(`Resized selection failed: ${JSON.stringify(resizedSelection)}`);
}
const replayAfterResize = await page.evaluate(async () => {
  const [action] = window.spectra.getActions();
  return window.spectra.replayAction(action.actionId);
});
if (!replayAfterResize || replayAfterResize.stale || !replayAfterResize.allVerified) {
  throw new Error(`Post-resize replay failed: ${JSON.stringify(replayAfterResize)}`);
}

const staleProbe = await page.evaluate(() => window.spectra.probeStale());
if (!staleProbe?.stale) {
  throw new Error(`Stale probe failed: ${JSON.stringify(staleProbe)}`);
}
const diagnosticsAfter = await page.evaluate(() => window.spectra.getDiagnostics());

const standardDpiPage = await browser.newPage({
  viewport: { width: 1200, height: 820 },
  deviceScaleFactor: 1,
});
await standardDpiPage.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await standardDpiPage.waitForTimeout(900);
const standardDpiResult = await standardDpiPage.evaluate(async () => {
  const viewport = window.spectra.viewer.getViewportState();
  const selection = await window.spectra.selectRect({
    x: viewport.cssWidth * 0.3,
    y: viewport.cssHeight * 0.24,
    width: viewport.cssWidth * 0.4,
    height: viewport.cssHeight * 0.48,
  });
  return { viewport, selection };
});
if (
  standardDpiResult.viewport.pixelRatio !== 1 ||
  standardDpiResult.selection.stale ||
  standardDpiResult.selection.verifiedCount !== standardDpiResult.selection.hitCount
) {
  throw new Error(`DPR 1 selection failed: ${JSON.stringify(standardDpiResult)}`);
}
await standardDpiPage.close();

console.log(
  JSON.stringify(
    {
      diagnosticsBefore,
      pickCount: registry?.length,
      viewport,
      result: result && {
        stale: result.stale,
        hitCount: result.hitCount,
        verifiedCount: result.verifiedCount,
        pixelCount: result.pixelCount,
        readMode: result.readMode,
        hits: result.hits?.slice(0, 12).map((hit) => ({
          pickId: hit.pickIdLabel,
          name: hit.name,
          pixels: hit.pixelCount,
          verified: hit.verified,
          instance: hit.instanceIndex,
        })),
      },
      replay: replay && {
        stale: replay.stale,
        hitCount: replay.hitCount,
        allVerified: replay.allVerified,
      },
      resizedSelection: resizedSelection && {
        hitCount: resizedSelection.hitCount,
        verifiedCount: resizedSelection.verifiedCount,
        viewport: resizedSelection.viewport,
      },
      replayAfterResize: replayAfterResize && {
        stale: replayAfterResize.stale,
        hitCount: replayAfterResize.hitCount,
        allVerified: replayAfterResize.allVerified,
      },
      staleProbe,
      diagnosticsAfter,
      standardDpi: {
        viewport: standardDpiResult.viewport,
        hitCount: standardDpiResult.selection.hitCount,
        verifiedCount: standardDpiResult.selection.verifiedCount,
      },
      messages,
    },
    null,
    2,
  ),
);

await browser.close();
