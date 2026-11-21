const COLORS = ["#e6b566", "#6fc6bd", "#df7e73"];

function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function axesX(values, left, right) {
  return values.map((value, index) => left + (right - left) * index / (values.length - 1));
}

function path(entries, xs, ys) {
  return entries.map((entry, index) => `${index ? "L" : "M"}${xs[index].toFixed(1)},${ys[index].toFixed(1)}`).join(" ");
}

function chartShell(width, height, title, yLabel) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    `<style>.bg{fill:#0c1114}.grid{stroke:#263137;stroke-width:1}.axis{fill:#7c8b8e;font:12px monospace}.title{fill:#e8e4d8;font:600 21px sans-serif}.label{fill:#9ba8a8;font:13px sans-serif}</style>`,
    `<rect width="${width}" height="${height}" class="bg"/>`,
    `<text x="72" y="31" class="title">${escape(title)}</text>`
  ];
}

export function convergenceSvg(cases) {
  const width = 980;
  const height = 480;
  const left = 72;
  const right = 952;
  const top = 54;
  const bottom = 416;
  const counts = cases[0].series.map((entry) => entry.samples);
  const xs = axesX(counts, left, right);
  const max = Math.ceil(Math.max(...cases.flatMap((entry) => entry.series.map((series) => series.rmse))) * 100) / 100;
  const parts = chartShell(width, height, "AO 收敛 · RMSE vs 样本数", "RMSE");
  for (let i = 0; i <= 4; i++) {
    const y = top + (bottom - top) * i / 4;
    const value = max * (1 - i / 4);
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"/>`);
    parts.push(`<text x="${left - 10}" y="${y + 4}" text-anchor="end" class="axis">${value.toFixed(3)}</text>`);
  }
  counts.forEach((count, index) => {
    parts.push(`<text x="${xs[index].toFixed(1)}" y="${bottom + 30}" text-anchor="middle" class="axis">${count}</text>`);
  });
  parts.push(`<text x="${(left + right) / 2}" y="${height - 10}" text-anchor="middle" class="label">samples / vertex</text>`);
  parts.push(`<text transform="translate(20 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" class="label">${escape("RMSE")}</text>`);
  cases.forEach((entry, caseIndex) => {
    const ys = entry.series.map((series) => bottom - series.rmse / max * (bottom - top));
    parts.push(`<path d="${path(entry.series, xs, ys)}" fill="none" stroke="${COLORS[caseIndex]}" stroke-width="2.8"/>`);
  });
  cases.forEach((entry, index) => {
    const x = 700 + index * 92;
    parts.push(`<circle cx="${x}" cy="27" r="4" fill="${COLORS[index]}"/>`);
    parts.push(`<text x="${x + 9}" y="32" class="label">${escape(entry.id)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("\n");
}

export function distanceSweepSvg(cases) {
  const width = 980;
  const height = 420;
  const left = 72;
  const right = 922;
  const top = 54;
  const bottom = 354;
  const distances = cases[0].distanceSweep.map((entry) => entry.maxDistance);
  const minLog = Math.log(Math.min(...distances));
  const maxLog = Math.log(Math.max(...distances));
  const xs = distances.map((value) => left + (Math.log(value) - minLog) / (maxLog - minLog) * (right - left));
  const parts = chartShell(width, height, "最大距离扫描 · 平均 AO", "AVG AO");
  distances.forEach((distance, index) => {
    parts.push(`<line x1="${xs[index].toFixed(1)}" y1="${top}" x2="${xs[index].toFixed(1)}" y2="${bottom}" class="grid"/>`);
    parts.push(`<text x="${xs[index].toFixed(1)}" y="${bottom + 24}" text-anchor="middle" class="axis">${distance}</text>`);
  });
  for (let i = 0; i <= 2; i++) {
    const y = bottom - i / 2 * (bottom - top);
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"/>`);
    parts.push(`<text x="${left - 10}" y="${y + 4}" text-anchor="end" class="axis">${(i / 2).toFixed(1)}</text>`);
  }
  cases.forEach((entry, caseIndex) => {
    const ys = entry.distanceSweep.map((series) => bottom - series.averageAO * (bottom - top));
    parts.push(`<path d="${path(entry.distanceSweep, xs, ys)}" fill="none" stroke="${COLORS[caseIndex]}" stroke-width="2.8"/>`);
  });
  cases.forEach((entry, index) => {
    const x = 700 + index * 92;
    parts.push(`<circle cx="${x}" cy="27" r="4" fill="${COLORS[index]}"/>`);
    parts.push(`<text x="${x + 9}" y="32" class="label">${escape(entry.id)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("\n");
}
