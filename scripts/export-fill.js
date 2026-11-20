// CLI: expand a stroked SVG path into a pure-fill SVG for downstream plotter
// preview. Reads a small JSON spec from stdin or a file argument.
//
// spec: { d, width, lineCap, lineJoin, miterLimit, dasharray, dashoffset,
//         transform:[a,b,c,d,e,f], width, height }
//
// Usage:
//   node scripts/export-fill.js spec.json > fill.svg
//   cat spec.json | node scripts/export-fill.js > fill.svg

'use strict';

const fs = require('fs');
const { strokeToFillPath } = require('../src/stroke-to-path');

function readSpec() {
  if (process.argv[2]) {
    return JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  }
  return JSON.parse(fs.readFileSync(0, 'utf8'));
}

const spec = readSpec();
const fillD = strokeToFillPath(spec.d, spec);
const width = spec.canvasWidth || 320;
const height = spec.canvasHeight || 240;

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
  viewBox="0 0 ${width} ${height}">
  <path d="${fillD}" fill="#111111" fill-rule="nonzero"/>
</svg>
`);
