// Artifact writers: CSV per-frame table, JSON stats, an SVG line chart and
// a dependency-free PNG chart (raw RGBA + zlib deflate, no native modules).

const fs = require('fs');
const zlib = require('zlib');

function writeCsv(file, rows) {
  const header = [
    'frame', 'lineX',
    'naive_mip3_peak', 'improved_mip3_peak',
    'naive_bloom_peak', 'improved_bloom_peak',
    'naive_mip3_energy', 'improved_mip3_energy',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      row.frame,
      row.lineX.toFixed(3),
      row.naive.mip3Peak.toFixed(6),
      row.improved.mip3Peak.toFixed(6),
      row.naive.bloomPeak.toFixed(6),
      row.improved.bloomPeak.toFixed(6),
      row.naive.mip3Energy.toFixed(6),
      row.improved.mip3Energy.toFixed(6),
    ].join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function writeStats(file, report) {
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function polyline(values, x0, x1, y0, y1, maxValue) {
  const step = (x1 - x0) / Math.max(1, values.length - 1);
  return values.map((value, i) => {
    const x = x0 + i * step;
    const y = y1 - (value / Math.max(maxValue, 1e-9)) * (y1 - y0);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function writeSvg(file, report, rows) {
  const W = 1000;
  const H = 560;
  const naivePeaks = rows.map((r) => r.naive.mip3Peak);
  const improvedPeaks = rows.map((r) => r.improved.mip3Peak);
  const naiveEnergy = rows.map((r) => r.naive.mip3Energy);
  const improvedEnergy = rows.map((r) => r.improved.mip3Energy);
  const peakMax = Math.max(...naivePeaks, ...improvedPeaks) * 1.15;
  const energyMax = Math.max(...naiveEnergy, ...improvedEnergy) * 1.15;

  const swingNaive = (report.stats.naive.mip3Peak.relativeRange * 100).toFixed(0);
  const swingImproved = (report.stats.improved.mip3Peak.relativeRange * 100).toFixed(0);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="monospace">
<rect width="${W}" height="${H}" fill="#0b1018"/>
<text x="32" y="38" fill="#e7eef7" font-size="16">FRAME-TO-FRAME BLOOM PEAK</text>
<text x="32" y="58" fill="#7d8da1" font-size="10">SUBPIXEL LINE SWEEP · 0.25 PX/FRAME · ${rows.length} FRAMES · ${report.config.width}x${report.config.height} · rgba16float HDR</text>
<text x="700" y="38" fill="#65e79a" font-size="11">GRAY CARD ${report.grayCard.target}</text>
<text x="700" y="55" fill="#d8e4f0" font-size="10">${report.grayCard.mean.toFixed(6)} · d ${report.grayCard.maxDeviation.toExponential(1)}</text>
<text x="32" y="92" fill="#8ea0b6" font-size="10">COARSTEST MIP PEAK (max RGB) — SWING ${swingNaive}% → ${swingImproved}%</text>
<rect x="32" y="104" width="936" height="180" fill="#0a0f16" stroke="#202936"/>
<polyline fill="none" stroke="#ff665d" stroke-width="2" points="${polyline(naivePeaks, 40, 960, 112, 276, peakMax)}"/>
<polyline fill="none" stroke="#67e8f9" stroke-width="2" points="${polyline(improvedPeaks, 40, 960, 112, 276, peakMax)}"/>
<text x="32" y="316" fill="#8ea0b6" font-size="10">COARSTEST MIP ENERGY (sum of max RGB)</text>
<rect x="32" y="328" width="936" height="170" fill="#0a0f16" stroke="#202936"/>
<polyline fill="none" stroke="#ff665d" stroke-width="2" points="${polyline(naiveEnergy, 40, 960, 336, 490, energyMax)}"/>
<polyline fill="none" stroke="#65e79a" stroke-width="2" points="${polyline(improvedEnergy, 40, 960, 336, 490, energyMax)}"/>
<text x="40" y="530" fill="#ff8a84" font-size="10">red: point sample</text>
<text x="220" y="530" fill="#67e8f9" font-size="10">cyan: soft-knee + 13-tap down / 9-tap up</text>
<text x="960" y="530" fill="#617187" font-size="10" text-anchor="end">upsample → HDR composite → exposure</text>
</svg>
`;
  fs.writeFileSync(file, svg);
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels.set(color, i);
  }

  fillRect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        this.setPixel(xx, yy, color);
      }
    }
  }

  line(x0, y0, x1, y1, color) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.setPixel(
        Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t),
        color,
      );
    }
  }

  polyline(values, x0, x1, y0, y1, maxValue, color) {
    const step = (x1 - x0) / Math.max(1, values.length - 1);
    let prev = null;
    values.forEach((value, i) => {
      const x = Math.round(x0 + i * step);
      const y = Math.round(y1 - (value / Math.max(maxValue, 1e-9)) * (y1 - y0));
      if (prev) this.line(prev.x, prev.y, x, y, color);
      prev = { x, y };
    });
  }

  // Minimal 5x7 bitmap font for labels (uppercase, digits, a few symbols).
  static FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10101', '10101', '10101', '11011', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    ':': ['00000', '00100', '00000', '00000', '00000', '00100', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
    '%': ['11001', '11010', '00100', '00100', '01000', '10110', '10011'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };

  text(str, x, y, color, scale = 1) {
    let cursor = x;
    for (const ch of str.toUpperCase()) {
      const glyph = Canvas.FONT[ch] || Canvas.FONT[' '];
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if (glyph[row][col] === '1') {
            this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += 6 * scale;
    }
  }

  encodePng() {
    const { width, height, pixels } = this;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
      raw[y * (stride + 1)] = 0;
      raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const deflated = zlib.deflateSync(raw);

    const chunks = [];
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    chunks.push(signature);
    pushChunk(chunks, 'IHDR', (() => {
      const b = Buffer.alloc(13);
      b.writeUInt32BE(width, 0);
      b.writeUInt32BE(height, 4);
      b[8] = 8;   // bit depth
      b[9] = 6;   // RGBA
      return b;
    })());
    pushChunk(chunks, 'IDAT', deflated);
    pushChunk(chunks, 'IEND', Buffer.alloc(0));
    return Buffer.concat(chunks);
  }
}

function pushChunk(chunks, type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  chunks.push(len, typeBuffer, data, crc);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

async function renderPngCharts(file, report, rows) {
  const W = 1000;
  const H = 520;
  const canvas = new Canvas(W, H);
  const bg = [11, 16, 24, 255];
  const grid = [32, 41, 54, 255];
  const red = [255, 102, 93, 255];
  const cyan = [103, 232, 249, 255];
  const green = [101, 231, 154, 255];
  const white = [231, 238, 247, 255];
  const gray = [142, 160, 182, 255];
  canvas.fillRect(0, 0, W, H, bg);
  canvas.text('FRAME-TO-FRAME BLOOM PEAK', 32, 12, white, 2);
  canvas.text(
    `GRAY CARD ${report.grayCard.mean.toFixed(4)} TARGET ${report.grayCard.target}`,
    32, 36, green, 1,
  );

  const panels = [
    { y0: 60, y1: 240, values: [rows.map((r) => r.naive.mip3Peak), rows.map((r) => r.improved.mip3Peak)], colors: [red, cyan] },
    { y0: 300, y1: 480, values: [rows.map((r) => r.naive.mip3Energy), rows.map((r) => r.improved.mip3Energy)], colors: [red, green] },
  ];

  for (const panel of panels) {
    canvas.fillRect(32, panel.y0, 936, panel.y1 - panel.y0, [10, 15, 22, 255]);
    for (let g = 0; g <= 4; g += 1) {
      const y = panel.y0 + ((panel.y1 - panel.y0) / 4) * g;
      canvas.line(32, y, 968, y, grid);
    }
    const maxValue = Math.max(...panel.values.flat()) * 1.15;
    panel.values.forEach((values, i) => {
      canvas.polyline(values, 40, 960, panel.y0 + 8, panel.y1 - 8, maxValue, panel.colors[i]);
    });
  }

  // Legend row on the right, clear of the title block.
  const legend = [
    { label: 'POINT SAMPLE', color: red, x: 560 },
    { label: 'SOFT+BOX', color: cyan, x: 720 },
    { label: 'ENERGY', color: green, x: 860 },
  ];
  for (const item of legend) {
    canvas.fillRect(item.x, 14, 16, 5, item.color);
    canvas.text(item.label, item.x + 22, 12, gray, 1);
  }
  canvas.text('COARSTEST MIP PEAK', 32, 74, gray, 1);
  canvas.text('COARSTEST MIP ENERGY', 32, 314, gray, 1);

  fs.writeFileSync(file, canvas.encodePng());
}

module.exports = { writeCsv, writeStats, writeSvg, renderPngCharts };
