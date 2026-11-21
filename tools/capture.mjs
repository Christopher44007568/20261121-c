import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(root, "artifacts");
await mkdir(artifactDir, { recursive: true });
const app = await startServer(root);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(240_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

const fmt = (value, digits = 2) => (
  Number.isFinite(value) ? value.toFixed(digits) : "n/a"
);

function encodePng(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

function toCsv(report) {
  const headers = [
    "pipeline", "distance", "tilt_deg", "samples", "roi_pixels",
    "hole_fraction_pct", "geometry_hole_fraction_pct", "hole_error_pp",
    "edge_mae_pct", "hole_relative_error_pct", "flicker_std_pct", "toggle_pct", "temporal_range_pct",
  ];
  const lines = [headers.join(",")];
  for (const row of report.measurements) {
    const values = [
      row.pipeline,
      row.distance,
      row.tiltDegrees,
      row.samples,
      row.roiPixels,
      row.holeFractionPct,
      row.geometryHoleFractionPct,
      row.holeErrorPp,
      row.edgeMaePct,
      row.holeRelativeErrorPct,
      row.flickerStdPct,
      row.togglePct,
      row.temporalRangePct,
    ];
    lines.push(values.map((value, index) => (
      index === 0 ? String(value) : (Number.isFinite(value) ? Number(value).toFixed(6) : "")
    )).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function toMarkdown(report) {
  const env = report.environment;
  const software = env.accelerationClass === "software-rasterizer";
  const rowFor = (pipeline, distance, tilt) => report.measurements.find(
    (row) => row.pipeline === pipeline && row.distance === distance && row.tiltDegrees === tilt,
  );
  const farHard = rowFor("hard", 32, 0);
  const farA2c = rowFor("a2c4", 32, 0);
  const farGeometry = rowFor("geometry", 32, 0);
  const nearA2c = rowFor("a2c4", 2.2, 0);
  const nearGeometry = rowFor("geometry", 2.2, 0);
  const edgeGeometry = rowFor("geometry", 2.2, 75);
  const edgeA2c = rowFor("a2c4", 2.2, 75);
  const openValues = report.mipChain.levels.map((row) => row.openFraction * 100);
  const mipRange = Math.max(...openValues) - Math.min(...openValues);
  const cost1x = report.msaaCost.find((row) => row.samples <= 1);
  const cost4x = report.msaaCost.find((row) => row.samples === 4);
  const scene1x = report.msaaSceneCost?.find((row) => row.samples <= 1);
  const scene4x = report.msaaSceneCost?.find((row) => row.samples === 4);
  const lines = [
    "# Alpha-tested perforated screen report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Environment",
    "",
    `- Renderer: \`${env.unmaskedRenderer || env.renderer}\``,
    `- Acceleration class: **${env.accelerationClass}**`,
    `- Time source: \`${report.msaaCost[0]?.timerSource ?? env.timerSource}\``,
    `- Texture anisotropy: ${env.anisotropy}×`,
    `- Test viewport: ${report.testMatrix.metricViewport.join(" × ")}`,
    `- Matrix: ${report.testMatrix.distances.length} distances × ${report.testMatrix.tiltDegrees.length} tilts × ${report.testMatrix.jitterPhases} jitter phases`,
    "",
  ];
  if (software) {
    lines.push(
      "> Warning: this capture ran on a software rasterizer. Timing values validate relative pipeline behavior only; run `npm run serve` on a GPU machine for hardware MSAA numbers.",
      "",
    );
  }
  lines.push(
    "## Key observations",
    "",
    `- Area-integrated mip open coverage stays within **${fmt(mipRange, 3)} pp** across L0–L9 (${fmt(Math.min(...openValues), 2)}%–${fmt(Math.max(...openValues), 2)}%).`,
    `- At distance 32 / tilt 0°, binary alpha-test drops to **${fmt(farHard?.holeFractionPct)}%** open versus **${fmt(farGeometry?.holeFractionPct)}%** for the mesh; A2C holds **${fmt(farA2c?.holeFractionPct)}%**.`,
    `- Close up at distance 2.2 / tilt 0°, A2C is within **${fmt(Math.abs((nearA2c?.holeFractionPct ?? 0) - (nearGeometry?.holeFractionPct ?? 0)), 2)} pp** of the true mesh aperture.`,
    `- At 75° tilt, true geometry falls to **${fmt(edgeGeometry?.holeFractionPct)}%** projected open area because plate thickness occludes the holes; the flat alpha card reports **${fmt(edgeA2c?.holeFractionPct)}%**. This is a thickness/parallax difference, not a mip-filtering win.`,
    `- Full-screen MSAA fill + resolve at 960×600: 1× **${fmt(cost1x?.msMedian, 3)} ms**, 4× **${fmt(cost4x?.msMedian, 3)} ms** (**${fmt(cost4x?.relativeTo1x, 2)}×**). ${software ? "Software rasterizer: not a hardware timing claim." : "Timer source: " + (cost4x?.timerSource ?? "unknown") + "."}`,
    "",
  );
  lines.push(
    "## Pipeline summary",
    "",
    "| Pipeline | Mean open | Mean abs hole error | Max abs hole error | Mean edge MAE | Flicker σ | Toggle rate |",
    "|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const row of report.summary) {
    const pipeline = report.summary.find((item) => item.pipeline === row.pipeline);
    lines.push(
      `| ${row.label} | ${fmt(row.meanHoleFractionPct)}% | ${fmt(row.meanAbsHoleErrorPp)} pp | ` +
      `${fmt(row.maxAbsHoleErrorPp)} pp | ${fmt(row.meanEdgeMaePct)}% | ` +
      `${fmt(row.meanFlickerStdPct)} pp | ${fmt(row.meanTogglePct)}% |`,
    );
  }
  lines.push(
    "",
    "## MSAA fill + resolve cost",
    "",
    "| Samples | Median stress frame @ 960×600 | Relative to 1x | Timer |",
    "|---:|---:|---:|---|",
  );
  for (const row of report.msaaCost) {
    lines.push(
      `| ${row.samples <= 1 ? "1x" : `${row.samples}x`} | ${fmt(row.msMedian, 3)} ms | ` +
      `${fmt(row.relativeTo1x, 2)}× | ${row.timerSource} |`,
    );
  }
  if (scene1x && scene4x) {
    lines.push(
      "",
      `A2C scene frame medians: 1× **${fmt(scene1x.msMedian, 3)} ms**, 4× **${fmt(scene4x.msMedian, 3)} ms** (**${fmt(scene4x.relativeTo1x, 2)}×**).`,
    );
  }
  if (software) {
    lines.push(
      "",
      "> SwiftShader can make the 2×/4× fill path non-monotonic. Raw min/median/max for every batch are retained in `report.json`; no theoretical values replace the measurements.",
    );
  }
  lines.push(
    "",
    "## Mip open coverage",
    "",
    "| Level | Size | Open |",
    "|---:|---:|---:|",
  );
  for (const row of report.mipChain.levels) {
    lines.push(`| L${row.level} | ${row.width}×${row.height} | ${fmt(row.openFraction * 100, 3)}% |`);
  }
  lines.push(
    "",
    `Analytic open fraction: **${fmt((1 - report.mipChain.analyticMetalFraction) * 100, 3)}%**.`,
    "",
    "## Artifacts",
    "",
    "- `geometry-reference.png` — true mesh close view with real hole rims.",
    "- `edge-comparison.png` — geometry vs A2C at 0° and 60° tilt.",
    "- `distance-sweep.png` — 5 distances × 4 pipelines at 30° tilt.",
    "- `tilt-sweep.png` — 4 tilts × 4 pipelines at distance 7.0.",
    "- `measurements.csv` — all 80 individual measurement rows.",
    "- `report.json` — full metadata, mip levels, metrics, and timings.",
    "",
    "Metrics: open% is measured inside the projected plate mask. Geometry error is the absolute difference from the 4× true-mesh coverage reference, in percentage points. Flicker σ is the temporal standard deviation of resolved coverage over 8 subpixel phases, in percentage points. Toggle rate counts pixels whose coverage range exceeds 0.5. The close-camera geometry has visible hole-wall occlusion, which is intentionally absent from the flat alpha card.",
    "",
  );
  return lines.join("\n");
}

try {
  await page.goto(app.url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => window.SCREEN_LAB_READY || window.SCREEN_LAB_ERROR,
    null,
    { timeout: 30_000 },
  );
  const initError = await page.evaluate(() => window.SCREEN_LAB_ERROR ?? null);
  if (initError) throw new Error(initError);
  console.log("Running 20-point sweep, jitter phases, and MSAA cost benchmark...");
  const report = await page.evaluate(() => window.ScreenLab.runFullScan());
  report.captureTool = {
    playwright: "1.65.1",
    browser: "Chromium",
    chromeFlags: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  };
  console.log(`Sweep complete in ${(report.durationMs / 1000).toFixed(1)} s. Rendering artifacts...`);
  const artifacts = await page.evaluate(
    (currentReport) => window.ScreenLab.captureArtifacts(currentReport),
    report,
  );

  await writeFile(
    path.join(artifactDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(artifactDir, "measurements.csv"), toCsv(report));
  await writeFile(path.join(artifactDir, "REPORT.md"), toMarkdown(report));
  for (const [name, dataUrl] of Object.entries(artifacts)) {
    await writeFile(path.join(artifactDir, name), encodePng(dataUrl));
  }

  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(artifactDir, "ui-overview.png"),
    fullPage: false,
  });

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log(`Artifacts written to ${artifactDir}`);
  console.log(`Renderer: ${report.environment.unmaskedRenderer || report.environment.renderer}`);
  console.log(`Measurement rows: ${report.measurements.length}`);
} finally {
  await browser.close();
  await app.close();
}
