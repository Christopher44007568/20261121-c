export const PIXEL_BINS = [
  [0, 0.000001],
  [0.000001, 0.00001],
  [0.00001, 0.0001],
  [0.0001, 0.001],
  [0.001, 0.01],
  [0.01, 0.1],
  [0.1, 1],
  [1, null],
];

export function quantile(sorted, fraction) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function histogram(values, bins = PIXEL_BINS) {
  const counts = bins.map(() => 0);
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    let index = bins.findIndex(([lower, upper]) => value >= lower && (upper === null || value < upper));
    if (index < 0) index = bins.length - 1;
    counts[index] += 1;
  }
  return bins.map(([lower, upper], index) => ({
    lowerPixels: lower,
    upperPixels: upper,
    count: counts[index],
  }));
}

export function summarize(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return {
      samples: 0,
      mean: NaN,
      median: NaN,
      p95: NaN,
      p99: NaN,
      max: NaN,
      min: NaN,
      histogram: histogram([]),
    };
  }
  const total = finite.reduce((sum, value) => sum + value, 0);
  return {
    samples: finite.length,
    mean: total / finite.length,
    median: quantile(finite, 0.5),
    p95: quantile(finite, 0.95),
    p99: quantile(finite, 0.99),
    max: finite.at(-1),
    min: finite[0],
    histogram: histogram(finite),
  };
}

export function roundStat(value, digits = 12) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toPrecision(digits));
}
