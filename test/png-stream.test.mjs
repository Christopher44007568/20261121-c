import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamingPngWriter } from "../src/png-stream.mjs";
import { decodePng } from "../src/compare.mjs";

test("streaming PNG round trips every channel", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skia-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "round-trip.png");
  const width = 17;
  const height = 9;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 13 + y * 7) & 0xff;
      pixels[offset + 1] = (x * 3 + y * 29) & 0xff;
      pixels[offset + 2] = (x * 17 + y * 5) & 0xff;
      pixels[offset + 3] = 255;
    }
  }

  const writer = new StreamingPngWriter({ path, width, height });
  await writer.start();
  for (let y = 0; y < height; y += 1) {
    await writer.writeRow(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
    );
  }
  const result = await writer.finish();
  const decoded = await decodePng(path);

  assert.equal(result.rows, height);
  assert.equal(result.bytesWritten, (await stat(path)).size);
  assert.deepEqual(Buffer.from(decoded.data), Buffer.from(pixels));
});

test("streaming PNG rejects malformed rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skia-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = new StreamingPngWriter({
    path: join(directory, "bad.png"),
    width: 4,
    height: 1,
  });
  await writer.start();
  await assert.rejects(() => writer.writeRow(new Uint8Array(4)), /expected 16 bytes/);
  await writer.abort();
});
