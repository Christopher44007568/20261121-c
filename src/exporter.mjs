import { compileScene } from "./effects.mjs";
import { MemoryMonitor } from "./memory.mjs";
import { StreamingPngWriter } from "./png-stream.mjs";
import { TileRenderer } from "./render.mjs";
import { SeamDetector } from "./seams.mjs";

function estimateWorkingBytes({ width, tileSize, apron, hasMasks }) {
  const band = width * tileSize * 4;
  const view = tileSize + apron * 2;
  const tileSurfaces = view * view * 4 * (hasMasks ? 3 : 1);
  const returnedTile = tileSize * tileSize * 4;
  const pngRows = width * 4 * 3;
  return band + tileSurfaces + returnedTile + pngRows;
}

export async function exportPoster({
  scene,
  outputPath,
  tileSize = 512,
  compressionLevel = 6,
  memoryBudgetBytes = Number.POSITIVE_INFINITY,
  detectSeams = true,
  seamOptions,
  onProgress,
}) {
  const compiled = compileScene(scene);
  if (!Number.isInteger(tileSize) || tileSize <= 0) {
    throw new RangeError("tileSize must be a positive integer");
  }
  if (!outputPath) {
    throw new TypeError("outputPath is required");
  }

  const apron = compiled.maxMargin;
  const estimatedWorkingBytes = estimateWorkingBytes({
    width: compiled.width,
    tileSize,
    apron,
    hasMasks: compiled.hasMasks,
  });
  const fullFrameBytes = compiled.width * compiled.height * 4;

  if (estimatedWorkingBytes > memoryBudgetBytes) {
    throw new RangeError(
      `estimated working set ${estimatedWorkingBytes} exceeds budget ${memoryBudgetBytes}`,
    );
  }

  const monitor = new MemoryMonitor();
  const writer = new StreamingPngWriter({
    path: outputPath,
    width: compiled.width,
    height: compiled.height,
    compressionLevel,
  });
  const detector = detectSeams
    ? new SeamDetector({
        width: compiled.width,
        height: compiled.height,
        tileWidth: tileSize,
        tileHeight: tileSize,
        options: seamOptions,
      })
    : null;

  const started = performance.now();
  let tiles = 0;
  let bands = 0;
  const rowBytes = compiled.width * 4;
  const renderer = new TileRenderer(compiled, {
    tileWidth: tileSize,
    tileHeight: tileSize,
    apron,
  });

  try {
    await writer.start();
    const band = Buffer.allocUnsafe(rowBytes * tileSize);

    for (let y = 0; y < compiled.height; y += tileSize) {
      const bandHeight = Math.min(tileSize, compiled.height - y);

      for (let x = 0; x < compiled.width; x += tileSize) {
        const tile = {
          x,
          y,
          width: Math.min(tileSize, compiled.width - x),
          height: bandHeight,
        };
        const rendered = renderer.render(tile);
        for (let row = 0; row < bandHeight; row += 1) {
          const sourceStart = row * tile.width * 4;
          const destinationStart = row * rowBytes + x * 4;
          band.set(
            rendered.data.subarray(sourceStart, sourceStart + tile.width * 4),
            destinationStart,
          );
        }
        tiles += 1;
        monitor.update();
      }

      detector?.addBand({ y, height: bandHeight, data: band });
      for (let row = 0; row < bandHeight; row += 1) {
        await writer.writeRow(
          band.subarray(row * rowBytes, (row + 1) * rowBytes),
        );
      }
      bands += 1;
      monitor.update();
      onProgress?.({
        renderedRows: y + bandHeight,
        height: compiled.height,
        tiles,
        bands,
        peakRssBytes: monitor.peak.rss,
      });
    }

    const output = await writer.finish();
    const seams = detector?.finish() || null;
    const elapsedMs = performance.now() - started;
    const memory = monitor.report({
      fullFrameBytes,
      estimatedWorkingBytes,
      fullFrameToWorkingSetRatio: fullFrameBytes / estimatedWorkingBytes,
    });

    return {
      ...output,
      width: compiled.width,
      height: compiled.height,
      tileSize,
      apron,
      tiles,
      bands,
      elapsedMs,
      memory,
      seams,
    };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
