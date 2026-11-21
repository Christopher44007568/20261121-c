import test from "node:test";
import assert from "node:assert/strict";
import { SeamDetector } from "../src/seams.mjs";

function gradientFrame(width, height, shift = 0) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const added = x >= width / 2 || y >= height / 2 ? shift : 0;
      data[offset] = Math.min(255, Math.round(x / width * 80) + added);
      data[offset + 1] = Math.min(255, Math.round(y / height * 60) + added);
      data[offset + 2] = 40 + added;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function addBands(detector, data, width, height, bandHeight) {
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += bandHeight) {
    detector.addBand({
      y,
      height: Math.min(bandHeight, height - y),
      data: data.subarray(y * rowBytes),
    });
  }
}

test("seam detector accepts smooth tile joins", () => {
  const width = 256;
  const height = 128;
  const detector = new SeamDetector({
    width,
    height,
    tileWidth: 64,
    tileHeight: 64,
  });
  addBands(detector, gradientFrame(width, height), width, height, 64);
  const result = detector.finish();

  assert.equal(result.vertical.length, 3);
  assert.equal(result.horizontal.length, 1);
  assert.equal(result.flagged, 0);
});

test("seam detector finds discontinuities at tile boundaries", () => {
  const width = 256;
  const height = 128;
  const detector = new SeamDetector({
    width,
    height,
    tileWidth: 64,
    tileHeight: 64,
  });
  addBands(detector, gradientFrame(width, height, 40), width, height, 64);
  const result = detector.finish();

  assert.ok(result.flagged >= 2);
  assert.equal(
    result.vertical.find((boundary) => boundary.position === 128).flagged,
    true,
  );
  assert.equal(result.horizontal[0].flagged, true);
});
