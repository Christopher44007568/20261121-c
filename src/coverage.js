import { SCREEN } from "./plate.js";

function downsample(source, width, height) {
  const nextWidth = Math.max(1, width >> 1);
  const nextHeight = Math.max(1, height >> 1);
  const out = new Uint8Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sx = Math.min(width - 1, x * 2);
      const sy = Math.min(height - 1, y * 2);
      const sx1 = Math.min(width - 1, sx + 1);
      const sy1 = Math.min(height - 1, sy + 1);
      const sum =
        source[sy * width + sx] +
        source[sy * width + sx1] +
        source[sy1 * width + sx] +
        source[sy1 * width + sx1];
      out[y * nextWidth + x] = Math.round(sum / 4);
    }
  }
  return { data: out, width: nextWidth, height: nextHeight };
}

function mean(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  return sum / data.length / 255;
}

export function createCoverageMips(screen = SCREEN, baseWidth = 960, baseHeight = 640) {
  const data = new Uint8Array(baseWidth * baseHeight);
  const texelsPerCellX = baseWidth / screen.columns;
  const texelsPerCellY = baseHeight / screen.rows;
  const normalizedRadius = screen.radius / screen.cell;
  const sampleCount = 4;
  const offsets = [];
  for (let oy = 0; oy < sampleCount; oy += 1) {
    for (let ox = 0; ox < sampleCount; ox += 1) {
      offsets.push([(ox + 0.5) / sampleCount, (oy + 0.5) / sampleCount]);
    }
  }

  for (let y = 0; y < baseHeight; y += 1) {
    const cellY = (y + 0.5) / texelsPerCellY;
    const fyBase = cellY - Math.floor(cellY) - 0.5;
    for (let x = 0; x < baseWidth; x += 1) {
      const cellX = (x + 0.5) / texelsPerCellX;
      const fxBase = cellX - Math.floor(cellX) - 0.5;
      let metal = 0;
      for (const [ox, oy] of offsets) {
        const fx = fxBase + (ox - 0.5) / texelsPerCellX;
        const fy = fyBase + (oy - 0.5) / texelsPerCellY;
        metal += Math.hypot(fx, fy) >= normalizedRadius ? 1 : 0;
      }
      data[y * baseWidth + x] = Math.round((metal / offsets.length) * 255);
    }
  }

  const levels = [];
  let current = { data, width: baseWidth, height: baseHeight };
  while (true) {
    levels.push({
      data: current.data,
      width: current.width,
      height: current.height,
      metalFraction: mean(current.data),
    });
    if (current.width === 1 && current.height === 1) break;
    current = downsample(current.data, current.width, current.height);
  }
  return {
    levels,
    baseWidth,
    baseHeight,
    analyticMetalFraction: 1 - (Math.PI * screen.radius * screen.radius) / (screen.cell * screen.cell),
  };
}
