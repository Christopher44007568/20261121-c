const { _electron: electron } = require("playwright-core");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const exportDirectory = path.join(projectRoot, "artifacts", "process-frames");

async function main() {
  await fs.rm(exportDirectory, { recursive: true, force: true });
  await fs.mkdir(path.join(projectRoot, "artifacts"), { recursive: true });

  const electronApp = await electron.launch({
    executablePath: path.join(projectRoot, "node_modules", "electron", "dist", "electron"),
    args: [projectRoot, "--no-sandbox", "--disable-gpu-sandbox"],
    env: {
      ...process.env,
      INK_GPU_MODE: "swiftshader"
    }
  });

  try {
  const page = await electronApp.firstWindow();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
    if (message.type() === "warning") console.warn(`[renderer] ${message.text()}`);
  });

  try {
    await page.waitForFunction(() => Boolean(window.__fiberInk?.ready), null, { timeout: 30000 });
  } catch (error) {
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "<unavailable>");
    const readyState = await page.evaluate(() => document.readyState).catch(() => "unknown");
    await page.screenshot({ path: path.join(projectRoot, "artifacts", "failure.png") }).catch(() => {});
    console.error("Renderer did not become ready.", { readyState, bodyText, consoleErrors });
    throw error;
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(projectRoot, "artifacts", "app-initial.png") });

  const initialDiagnostics = await page.evaluate(() => window.__fiberInk.getDiagnostics());
  await page.click("#zoomIn");
  await page.click("#zoomIn");
  const zoomedDiagnostics = await page.evaluate(() => window.__fiberInk.getDiagnostics());
  await page.click("#zoomFit");
  const zoomCheck = {
    before: initialDiagnostics.simulation,
    after: zoomedDiagnostics.simulation,
    domainStable:
      zoomedDiagnostics.simulation.width === initialDiagnostics.simulation.width &&
      zoomedDiagnostics.simulation.height === initialDiagnostics.simulation.height
  };
  const results = await page.evaluate(() => window.__fiberInk.runAllTests());
  const exportResult = await page.evaluate(
    (directory) => window.__fiberInk.exportFramesTo(directory),
    exportDirectory
  );
  const diagnostics = await page.evaluate(() => window.__fiberInk.getDiagnostics());
  await page.screenshot({ path: path.join(projectRoot, "artifacts", "app-tested.png") });

  const frameFiles = (await fs.readdir(exportDirectory)).filter((name) => name.endsWith(".png"));
  const summary = {
    webgl2: initialDiagnostics.simulation,
    zoomCheck,
    tests: results.map((result) => ({
      id: result.id,
      pass: result.pass,
      value: result.value,
      detail: result.detail,
      metrics: result.metrics
    })),
    export: {
      frameFiles: frameFiles.length,
      sampleFrames: frameFiles.slice(0, 2).concat(frameFiles.slice(-2)),
      driftPercent: exportResult.manifest.pigmentDriftPercent
    },
    final: diagnostics,
    consoleErrors
  };
  console.log(JSON.stringify(summary, null, 2));

  const failures = results.filter((result) => !result.pass);
  if (!zoomCheck.domainStable || zoomCheck.after.zoom <= zoomCheck.before.zoom) {
    throw new Error("Zoom changed the fixed simulation domain");
  }
  if (failures.length) throw new Error(`Diagnostic failures: ${failures.map((item) => item.id).join(", ")}`);
  if (frameFiles.length !== exportResult.manifest.frameCount) {
    throw new Error(`Expected ${exportResult.manifest.frameCount} frames, received ${frameFiles.length}`);
  }
  if (Math.abs(exportResult.manifest.pigmentDriftPercent) >= 0.75) {
    throw new Error(`Export conservation drift is ${exportResult.manifest.pigmentDriftPercent}%`);
  }
  if (consoleErrors.length) {
    throw new Error(`Renderer errors: ${consoleErrors.join(" | ")}`);
  }

  } finally {
    await electronApp.close().catch(() => {});
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
