// Lightweight MSDF error correction, inspired by msdfgen's
// MSDFErrorCorrection. The median of the three channels can disagree with the
// true inside/outside state when one channel was clamped by the limited
// distance range or has no edge nearby. We correct texel-by-texel using the
// analytic winding result, nudging only the channel closest to the boundary
// so smooth regions and real edges are left untouched.

export function correctChannels(field, median, insideAtGrid, size) {
  let corrected = 0;
  for (let idx = 0; idx < size * size; idx++) {
    const base = idx * 4;
    const wantNegative = insideAtGrid[idx] === 1;
    const r = field[base];
    const g = field[base + 1];
    const b = field[base + 2];
    const m = median[idx];
    const medNegative = m < 0;
    if (medNegative === wantNegative) continue;
    corrected++;

    const channels = [
      { value: r, offset: 0 },
      { value: g, offset: 1 },
      { value: b, offset: 2 },
    ];
    // Move the channel nearest zero across the boundary; this flips the
    // median while changing the smallest possible distance.
    channels.sort((u, v) => Math.abs(u.value) - Math.abs(v.value));
    const nearest = Math.abs(channels[0].value);
    const target = wantNegative ? -nearest - 1e-4 : nearest + 1e-4;
    field[base + channels[0].offset] = target;
    median[idx] = medianOf(
      field[base],
      field[base + 1],
      field[base + 2]
    );
  }
  return corrected;
}

function medianOf(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
