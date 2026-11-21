import { createCanvas, loadImage } from "@napi-rs/canvas";
import { compileScene } from "./effects.mjs";
import { drawScene } from "./render.mjs";

export function renderWholeScene(scene) {
  const compiled = compileScene(scene);
  const canvas = createCanvas(compiled.width, compiled.height);
  const ctx = canvas.getContext("2d");
  drawScene(ctx, compiled, {
    x: 0,
    y: 0,
    width: compiled.width,
    height: compiled.height,
  });
  return ctx.getImageData(0, 0, compiled.width, compiled.height);
}

export async function decodePng(path) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

export function comparePixels(expected, actual, { threshold = 1 } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new RangeError(
      `size mismatch: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`,
    );
  }

  const a = expected.data;
  const b = actual.data;
  let absoluteError = 0;
  let maxError = 0;
  let pixelsOverThreshold = 0;
  let squaredError = 0;

  for (let pixel = 0; pixel < a.length; pixel += 4) {
    let pixelMax = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(a[pixel + channel] - b[pixel + channel]);
      absoluteError += delta;
      squaredError += delta * delta;
      if (delta > pixelMax) {
        pixelMax = delta;
      }
    }
    if (pixelMax > maxError) {
      maxError = pixelMax;
    }
    if (pixelMax > threshold) {
      pixelsOverThreshold += 1;
    }
  }

  const pixels = expected.width * expected.height;
  const samples = pixels * 4;
  const meanAbsoluteError = absoluteError / samples;
  const mse = squaredError / samples;
  return {
    width: expected.width,
    height: expected.height,
    pixels,
    threshold,
    meanAbsoluteError,
    maxError,
    pixelsOverThreshold,
    percentOverThreshold: (pixelsOverThreshold / pixels) * 100,
    psnr: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
  };
}
