export const JITTERS = Object.freeze([
  [0.0, 0.0],
  [-0.375, -0.125],
  [0.375, 0.125],
  [-0.125, 0.375],
  [0.125, -0.375],
  [-0.3125, 0.3125],
  [0.3125, -0.3125],
  [0.0, 0.25],
]);

export function makeRoi(maskPixels, threshold = 0.5) {
  const flags = new Uint8Array(maskPixels.length / 4);
  let count = 0;
  for (let i = 0; i < flags.length; i += 1) {
    if (maskPixels[i * 4] / 255 > threshold) {
      flags[i] = 1;
      count += 1;
    }
  }
  return { flags, count };
}

export function coverageChannel(pixels) {
  const out = new Float32Array(pixels.length / 4);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = pixels[i * 4] / 255;
  }
  return out;
}

export function holeFraction(coverage, roi) {
  if (!roi.count) return Number.NaN;
  let metal = 0;
  let count = 0;
  for (let i = 0; i < roi.flags.length; i += 1) {
    if (!roi.flags[i]) continue;
    metal += coverage[i];
    count += 1;
  }
  return 1 - metal / count;
}

export function edgeMae(coverage, reference, roi) {
  if (!roi.count) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < roi.flags.length; i += 1) {
    if (roi.flags[i]) sum += Math.abs(coverage[i] - reference[i]);
  }
  return sum / roi.count;
}

export function temporalStats(frames, roi) {
  if (!roi.count) {
    return { flickerStdPct: Number.NaN, togglePct: Number.NaN, temporalRangePct: Number.NaN };
  }
  let stdSum = 0;
  let rangeSum = 0;
  let toggles = 0;
  for (let i = 0; i < roi.flags.length; i += 1) {
    if (!roi.flags[i]) continue;
    let sum = 0;
    let sumSq = 0;
    let min = 1;
    let max = 0;
    for (const frame of frames) {
      const value = frame[i];
      sum += value;
      sumSq += value * value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const mean = sum / frames.length;
    const variance = Math.max(0, sumSq / frames.length - mean * mean);
    const range = max - min;
    stdSum += Math.sqrt(variance);
    rangeSum += range;
    if (range > 0.5) toggles += 1;
  }
  return {
    flickerStdPct: (stdSum / roi.count) * 100,
    togglePct: (toggles / roi.count) * 100,
    temporalRangePct: (rangeSum / roi.count) * 100,
  };
}

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.pipeline)) groups.set(row.pipeline, []);
    groups.get(row.pipeline).push(row);
  }
  const summary = [];
  for (const [pipeline, values] of groups) {
    const avg = (key) => {
      const finite = values.map((value) => value[key]).filter(Number.isFinite);
      return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Number.NaN;
    };
    const maxAbs = (key) => {
      const finite = values.map((value) => Math.abs(value[key])).filter(Number.isFinite);
      return finite.length ? Math.max(...finite) : Number.NaN;
    };
    summary.push({
      pipeline,
      label: values[0].label,
      configs: values.length,
      meanHoleFractionPct: avg("holeFractionPct"),
      meanAbsHoleErrorPp: (() => {
        const finite = values.map((value) => Math.abs(value.holeErrorPp)).filter(Number.isFinite);
        return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Number.NaN;
      })(),
      maxAbsHoleErrorPp: maxAbs("holeErrorPp"),
      meanEdgeMaePct: avg("edgeMaePct"),
      meanFlickerStdPct: avg("flickerStdPct"),
      meanTogglePct: avg("togglePct"),
    });
  }
  return summary;
}

export function mipChainReport(mask) {
  return mask.levels.map((level, index) => ({
    level: index,
    width: level.width,
    height: level.height,
    metalFraction: level.metalFraction,
    openFraction: 1 - level.metalFraction,
  }));
}

export function summarizeBy(rows, key, values) {
  return values.map((value) => ({
    [key]: value,
    pipelines: summarize(rows.filter((row) => row[key] === value)),
  }));
}
