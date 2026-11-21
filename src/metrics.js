// Numeric summaries used to compare the naive and improved bloom paths.

// Peak = largest single-channel value in the texture.
function peak(data) {
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    if (m > max) max = m;
  }
  return max;
}

// Energy = sum over texels of max(R, G, B), i.e. total HDR light carried
// by the texture regardless of where it lands spatially.
function energy(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += Math.max(data[i], data[i + 1], data[i + 2]);
  }
  return sum;
}

function seriesStats(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const range = max - min;
  const relativeRange = mean > 1e-9 ? range / mean : range;
  let maxStep = 0;
  for (let i = 1; i < values.length; i += 1) {
    maxStep = Math.max(maxStep, Math.abs(values[i] - values[i - 1]));
  }
  const maxStepRelative = mean > 1e-9 ? maxStep / mean : maxStep;
  return { min, max, mean, range, relativeRange, maxStep, maxStepRelative };
}

// Mean and max deviation of a rectangular region against a target value,
// measured per channel.
function regionAccuracy(data, width, height, box, target) {
  const x0 = box?.x0 ?? 0;
  const y0 = box?.y0 ?? 0;
  const x1 = box?.x1 ?? width;
  const y1 = box?.y1 ?? height;
  let sum = 0;
  let maxDeviation = 0;
  let samples = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const base = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[base + channel];
        sum += value;
        maxDeviation = Math.max(maxDeviation, Math.abs(value - target));
        samples += 1;
      }
    }
  }
  return { mean: sum / samples, maxDeviation, samples };
}

module.exports = { peak, energy, seriesStats, regionAccuracy };
