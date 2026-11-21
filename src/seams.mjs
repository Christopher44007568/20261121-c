function channelDiff(dataA, a, dataB = dataA, b = a) {
  const dr = Math.abs(dataA[a] - dataB[b]);
  const dg = Math.abs(dataA[a + 1] - dataB[b + 1]);
  const db = Math.abs(dataA[a + 2] - dataB[b + 2]);
  const da = Math.abs(dataA[a + 3] - dataB[b + 3]);
  return (dr + dg + db + da) / 4;
}

function emptyBoundary(position, axis) {
  return {
    position,
    axis,
    samples: 0,
    seamSum: 0,
    baselineSum: 0,
    excessSum: 0,
    maxExcess: 0,
    pixelsAboveThreshold: 0,
  };
}

function addSample(boundary, seam, baseline, threshold) {
  const excess = Math.max(0, seam - baseline);
  boundary.samples += 1;
  boundary.seamSum += seam;
  boundary.baselineSum += baseline;
  boundary.excessSum += excess;
  boundary.maxExcess = Math.max(boundary.maxExcess, excess);
  if (excess > threshold) {
    boundary.pixelsAboveThreshold += 1;
  }
}

function finalizeBoundary(boundary, options) {
  const samples = boundary.samples || 1;
  const meanExcess = boundary.excessSum / samples;
  const meanDelta = (boundary.seamSum - boundary.baselineSum) / samples;
  const aboveRatio = boundary.pixelsAboveThreshold / samples;
  return {
    ...boundary,
    meanSeam: boundary.seamSum / samples,
    meanBaseline: boundary.baselineSum / samples,
    meanDelta,
    meanExcess,
    aboveRatio,
    flagged:
      meanDelta > options.meanThreshold &&
      aboveRatio > options.pixelRatioThreshold,
  };
}

/**
 * Detects tile seams while bands are still in cache. It compares the
 * cross-seam derivative with the adjacent derivatives, so a smooth gradient
 * does not count as a seam.
 */
export class SeamDetector {
  constructor({ width, height, tileWidth, tileHeight, options = {} }) {
    this.width = width;
    this.height = height;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.options = {
      pixelThreshold: 4,
      meanThreshold: 1.5,
      pixelRatioThreshold: 0.005,
      ...options,
    };
    this.vertical = [];
    for (let x = this.tileWidth; x < this.width; x += this.tileWidth) {
      this.vertical.push(emptyBoundary(x, "vertical"));
    }
    this.horizontal = new Map();
    this._previousRows = null;
    this._previousY = null;
  }

  addBand({ y, height, data }) {
    const rowBytes = this.width * 4;

    for (const boundary of this.vertical) {
      const x = boundary.position;
      const offset = x * 4;
      for (let row = 0; row < height; row += 1) {
        const base = row * rowBytes;
        const seam = channelDiff(data, base + offset - 4, data, base + offset);
        const left = channelDiff(data, base + offset - 8, data, base + offset - 4);
        const right = channelDiff(data, base + offset, data, base + offset + 4);
        addSample(boundary, seam, (left + right) / 2, this.options.pixelThreshold);
      }
    }

    if (this._previousRows && y === this._previousY + this._previousRows.height) {
      this._scoreHorizontalBoundary(data, height);
    }
    this._previousY = y;
    this._previousRows = {
      height,
      rows: this._trailingRows(data, height),
    };
  }

  _scoreHorizontalBoundary(data, height) {
    const rowBytes = this.width * 4;
    const y = this._previousY + this._previousRows.height;
    const boundary = this.horizontal.get(y) || emptyBoundary(y, "horizontal");
    const previous = this._previousRows.rows;
    const last = previous.at(-1);
    const beforeLast = previous.length > 1 ? previous.at(-2) : last;
    const current = data.subarray(0, rowBytes);
    const afterCurrent = height > 1 ? data.subarray(rowBytes, rowBytes * 2) : current;

    for (let x = 0; x < this.width; x += 1) {
      const offset = x * 4;
      const seam = channelDiff(last, offset, current, offset);
      const above = channelDiff(beforeLast, offset, last, offset);
      const below = channelDiff(current, offset, afterCurrent, offset);
      addSample(boundary, seam, (above + below) / 2, this.options.pixelThreshold);
    }
    this.horizontal.set(y, boundary);
  }

  _trailingRows(data, height) {
    const rowBytes = this.width * 4;
    const copyRow = (start, end) => Uint8Array.from(data.subarray(start, end));
    return height >= 2
      ? [
          copyRow((height - 2) * rowBytes, (height - 1) * rowBytes),
          copyRow((height - 1) * rowBytes, height * rowBytes),
        ]
      : [copyRow((height - 1) * rowBytes, height * rowBytes)];
  }

  finish() {
    const vertical = this.vertical.map((boundary) =>
      finalizeBoundary(boundary, this.options),
    );
    const horizontal = [...this.horizontal.values()]
      .sort((a, b) => a.position - b.position)
      .map((boundary) => finalizeBoundary(boundary, this.options));

    return {
      options: this.options,
      vertical,
      horizontal,
      flagged: [...vertical, ...horizontal].filter((item) => item.flagged).length,
    };
  }
}
