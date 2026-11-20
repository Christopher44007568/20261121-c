import { describe, expect, it } from "vitest";
import {
  clampRectToViewport,
  compareHitManifests,
  cssRectToBufferRect,
  decodeIdChannels,
  encodeIdChannels,
  manifestFingerprint,
  normalizeRect,
  scaleCssRect,
} from "../src/selection/idCodec.js";

describe("object ID codec", () => {
  it("round-trips every channel boundary", () => {
    for (const id of [1, 255, 256, 65535, 65536, 0x7f12ab, 0xffffff]) {
      expect(decodeIdChannels(...encodeIdChannels(id))).toBe(id);
    }
  });

  it("keeps zero reserved for an empty ID fragment", () => {
    expect(encodeIdChannels(0)).toEqual([0, 0, 0]);
  });
});

describe("selection rectangle transforms", () => {
  it("normalizes a reverse drag", () => {
    expect(normalizeRect({ x: 90, y: 70 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 70,
      height: 60,
    });
  });

  it("maps CSS pixels to a high-DPI framebuffer with a flipped read origin", () => {
    const result = cssRectToBufferRect(
      { x: 10, y: 20, width: 30, height: 40 },
      { width: 200, height: 100 },
      { width: 400, height: 200 },
    );

    expect(result).toMatchObject({
      x: 20,
      y: 80,
      width: 60,
      height: 80,
      scaleX: 2,
      scaleY: 2,
    });
  });

  it("clamps a rectangle to the viewport", () => {
    expect(
      clampRectToViewport({ x: -5, y: 12, width: 50, height: 100 }, { width: 40, height: 80 }),
    ).toEqual({ x: 0, y: 12, width: 40, height: 68 });
  });

  it("rescales recorded actions across a resized viewport", () => {
    expect(
      scaleCssRect(
        { x: 10, y: 20, width: 30, height: 40 },
        { width: 200, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ x: 20, y: 60, width: 60, height: 120 });
  });
});

describe("hit manifest audit", () => {
  const hits = [
    { pickId: 7, pixelCount: 120, verified: true },
    { pickId: 9, pixelCount: 30, verified: true },
  ];

  it("detects missing, extra, and pixel-count changes", () => {
    expect(
      compareHitManifests(hits, [
        { pickId: 7, pixelCount: 118 },
        { pickId: 11, pixelCount: 4 },
      ]),
    ).toEqual({
      equal: false,
      missing: [9],
      extra: [11],
      pixelDeltas: [{ pickId: 7, expected: 120, actual: 118 }],
    });
  });

  it("creates stable fingerprints independent of hit order", () => {
    expect(manifestFingerprint(hits, 150)).toBe("150/7:120|9:30");
    expect(manifestFingerprint([...hits].reverse(), 150)).toBe("150/7:120|9:30");
  });
});
