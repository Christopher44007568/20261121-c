import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScene } from "../src/effects.mjs";
import { exportPoster } from "../src/exporter.mjs";
import { createPosterScene } from "../src/poster.mjs";
import { comparePixels, decodePng, renderWholeScene } from "../src/compare.mjs";

test("tiled poster matches a whole-frame render", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skia-medium-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "poster.png");
  const scene = createPosterScene(640, 480);
  const compiled = compileScene(scene);

  const result = await exportPoster({
    scene,
    outputPath,
    tileSize: 160,
    memoryBudgetBytes: 64 * 1024 * 1024,
  });
  const expected = renderWholeScene(scene);
  const actual = await decodePng(outputPath);
  const difference = comparePixels(expected, actual, { threshold: 1 });

  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.equal(result.apron, compiled.maxMargin);
  assert.equal(result.tiles, 12);
  assert.equal(difference.maxError, 1);
  assert.equal(difference.pixelsOverThreshold, 0);
  assert.ok(difference.psnr > 65);
  assert.equal(result.seams.flagged, 0);
  assert.equal((await stat(outputPath)).size, result.bytesWritten);
});

test("exporter refuses a working set over budget", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skia-budget-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      exportPoster({
        scene: createPosterScene(640, 480),
        outputPath: join(directory, "rejected.png"),
        tileSize: 160,
        memoryBudgetBytes: 1024,
      }),
    /exceeds budget/,
  );
});
