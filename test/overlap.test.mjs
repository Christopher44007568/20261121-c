import test from "node:test";
import assert from "node:assert/strict";
import { compileScene } from "../src/effects.mjs";
import { comparePixels, renderWholeScene } from "../src/compare.mjs";
import { renderTile } from "../src/render.mjs";

function leftHalf(image, width, height) {
  const data = new Uint8Array(width * height * 4);
  const sourceRow = image.width * 4;
  const targetRow = width * 4;
  for (let row = 0; row < height; row += 1) {
    data.set(
      image.data.subarray(row * sourceRow, row * sourceRow + targetRow),
      row * targetRow,
    );
  }
  return { width, height, data };
}

test("filter tails require the computed apron", () => {
  const scene = compileScene({
    width: 320,
    height: 200,
    background(ctx) {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, 320, 200);
    },
    ops: [
      {
        id: "off-tile-filtered-dot",
        bounds: { x: 130, y: 80, width: 40, height: 40 },
        effects: {
          filter: { blur: 12 },
          mask: { kind: "linear" },
        },
        draw(ctx) {
          ctx.beginPath();
          ctx.arc(150, 100, 20, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        },
      },
    ],
  });
  const expected = leftHalf(renderWholeScene(scene), 128, 200);
  const tile = { x: 0, y: 0, width: 128, height: 200 };

  const noApron = comparePixels(
    expected,
    { width: 128, height: 200, data: renderTile(scene, tile, 0).data },
    { threshold: 1 },
  );
  const withApron = comparePixels(
    expected,
    {
      width: 128,
      height: 200,
      data: renderTile(scene, tile, scene.maxMargin).data,
    },
    { threshold: 1 },
  );

  assert.ok(noApron.maxError > 10);
  assert.ok(noApron.pixelsOverThreshold > 100);
  assert.ok(withApron.maxError <= 1);
  assert.equal(withApron.pixelsOverThreshold, 0);
});
