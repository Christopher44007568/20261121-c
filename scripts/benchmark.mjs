import { mkdir, writeFile } from "node:fs/promises";
import { createPosterScene } from "../src/poster.mjs";
import { exportPoster } from "../src/exporter.mjs";
import { comparePixels, decodePng, renderWholeScene } from "../src/compare.mjs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new RangeError(`expected WIDTHxHEIGHT, got ${value}`);
  }
  return [Number(match[1]), Number(match[2])];
}

function seamSummary(seams) {
  const all = [...seams.vertical, ...seams.horizontal];
  return {
    flagged: seams.flagged,
    verticalBoundaries: seams.vertical.length,
    horizontalBoundaries: seams.horizontal.length,
    maxMeanExcess: Math.max(0, ...all.map((boundary) => boundary.meanExcess)),
    maxPixelExcess: Math.max(0, ...all.map((boundary) => boundary.maxExcess)),
  };
}

await mkdir("artifacts", { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
};

const mediumSize = parseSize(option("medium", "1280x960"));
const mediumTile = Number(option("medium-tile", "256"));
const mediumScene = createPosterScene(...mediumSize);
const medium = await exportPoster({
  scene: mediumScene,
  outputPath: "artifacts/medium-tiled.png",
  tileSize: mediumTile,
  memoryBudgetBytes: 256 * 1024 * 1024,
});
const whole = renderWholeScene(mediumScene);
const tiled = await decodePng(medium.path);
const comparison = comparePixels(whole, tiled, { threshold: 1 });

if (comparison.maxError > 1 || comparison.pixelsOverThreshold !== 0) {
  throw new Error(
    `medium pixel comparison failed: max=${comparison.maxError}, over=${comparison.pixelsOverThreshold}`,
  );
}
if (medium.seams.flagged !== 0) {
  throw new Error(`medium seam detector flagged ${medium.seams.flagged} boundaries`);
}

report.medium = {
  dimensions: mediumSize,
  tileSize: mediumTile,
  apron: medium.apron,
  tiles: medium.tiles,
  elapsedMs: medium.elapsedMs,
  outputBytes: medium.bytesWritten,
  peakRssBytes: medium.memory.peakRssBytes,
  fullFrameBytes: medium.memory.fullFrameBytes,
  pixelDiff: comparison,
  seams: seamSummary(medium.seams),
};

const largeSize = parseSize(option("large", "12000x8000"));
const largeTile = Number(option("large-tile", "512"));
const budgetMb = Number(option("budget-mb", "128"));
const memoryBudgetBytes = budgetMb * 1024 * 1024;
const largeScene = createPosterScene(...largeSize, { effectScale: 1 });
const large = await exportPoster({
  scene: largeScene,
  outputPath: "artifacts/large-tiled.png",
  tileSize: largeTile,
  memoryBudgetBytes,
});

if (large.memory.fullFrameBytes <= memoryBudgetBytes) {
  throw new Error("large benchmark must exceed the working-set budget");
}
if (large.memory.peakRssBytes >= large.memory.fullFrameBytes) {
  throw new Error(
    `peak RSS ${large.memory.peakRssBytes} reached full-frame size ${large.memory.fullFrameBytes}`,
  );
}
if (large.seams.flagged !== 0) {
  throw new Error(`large seam detector flagged ${large.seams.flagged} boundaries`);
}

report.large = {
  dimensions: largeSize,
  tileSize: largeTile,
  apron: large.apron,
  tiles: large.tiles,
  bands: large.bands,
  elapsedMs: large.elapsedMs,
  outputBytes: large.bytesWritten,
  memoryBudgetBytes,
  fullFrameBytes: large.memory.fullFrameBytes,
  estimatedWorkingBytes: large.memory.estimatedWorkingBytes,
  peakRssBytes: large.memory.peakRssBytes,
  peakRssToFullFrameRatio:
    large.memory.peakRssBytes / large.memory.fullFrameBytes,
  fullFrameToWorkingSetRatio: large.memory.fullFrameToWorkingSetRatio,
  seams: seamSummary(large.seams),
};

await writeFile("artifacts/benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
