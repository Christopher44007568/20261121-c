import { mkdir } from "node:fs/promises";
import { createPosterScene } from "../src/poster.mjs";
import { exportPoster } from "../src/exporter.mjs";

const width = Number(process.argv[2]) || 1600;
const height = Number(process.argv[3]) || 1200;
const outputPath = process.argv[4] || "artifacts/poster.png";

await mkdir("artifacts", { recursive: true });
const result = await exportPoster({
  scene: createPosterScene(width, height),
  outputPath,
  tileSize: 256,
  memoryBudgetBytes: 256 * 1024 * 1024,
  onProgress({ renderedRows, height: total }) {
    process.stderr.write(`\rrendering ${renderedRows}/${total}`);
  },
});
process.stderr.write("\n");

console.log(
  JSON.stringify(
    {
      output: result.path,
      dimensions: `${result.width}x${result.height}`,
      tiles: result.tiles,
      apron: result.apron,
      elapsedMs: Math.round(result.elapsedMs),
      bytes: result.bytesWritten,
      peakRssBytes: result.memory.peakRssBytes,
      fullFrameBytes: result.memory.fullFrameBytes,
      seamsFlagged: result.seams?.flagged ?? null,
    },
    null,
    2,
  ),
);
