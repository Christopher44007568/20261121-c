export function downsampleMax(source, width, height) {
  const nextWidth = Math.max(1, width >> 1);
  const nextHeight = Math.max(1, height >> 1);
  const data = new Float32Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x * 2 + 1);
      const y0 = Math.min(height - 1, y * 2);
      const y1 = Math.min(height - 1, y * 2 + 1);
      data[y * nextWidth + x] = Math.max(
        source[y0 * width + x0],
        source[y0 * width + x1],
        source[y1 * width + x0],
        source[y1 * width + x1]
      );
    }
  }
  return { data, width: nextWidth, height: nextHeight };
}

export function buildMaxPyramid(source, width, height, levels) {
  const chain = [{ data: source, width, height }];
  for (let level = 1; level < levels; level++) {
    const previous = chain[level - 1];
    chain.push(downsampleMax(previous.data, previous.width, previous.height));
  }
  return chain;
}
