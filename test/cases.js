// Shared scene definitions for reference rendering and differential testing.
// Every scene renders the same stroked path twice:
//   reference: native browser stroke
//   candidate: our expanded pure-fill path
// Geometry is placed inside a 320x240 viewport with a known margin.

'use strict';

const VIEWBOX = { width: 320, height: 240 };

const cases = [
  {
    id: 'closed-dash-seam',
    title: '闭合路径首尾虚线接头',
    d: 'M60 60 L260 60 L260 180 L60 180 Z',
    style: {
      width: 12,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 4,
      dasharray: [26, 14],
      dashoffset: 18,
    },
  },
  {
    id: 'acute-miter',
    title: '锐角斜接（含 miter-limit 回落）',
    // Sharp ~18 degree apex, plus one deliberately over-limit spike.
    d: 'M40 200 L150 70 L175 205 L260 60',
    style: {
      width: 16,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 4,
    },
  },
  {
    id: 'zero-length-subpath',
    title: '零长度子路径（butt/round/square 端帽）',
    // Each variant places a truly zero-length subpath and a short real
    // subpath side by side, so both the epsilon skip and the cap dot are
    // exercised against the browser in one frame.
    d: 'M70 120 M70 120 M250 120 L252 120',
    variants: [
      { lineCap: 'butt' },
      { lineCap: 'round' },
      { lineCap: 'square' },
    ],
    style: { width: 24, lineJoin: 'miter', miterLimit: 4 },
  },
  {
    id: 'nonuniform-scale',
    title: '非均匀缩放下的描边',
    d: 'M30 120 C70 30, 130 210, 180 120 S270 40, 290 120',
    transform: [1.8, 0, 0, 0.55, 0, 0],
    // Keep the transformed shape on canvas.
    translate: [0, 55],
    style: {
      width: 14,
      lineCap: 'round',
      lineJoin: 'round',
      miterLimit: 4,
    },
  },
  {
    id: 'triangle-fill-export',
    title: '扩展后的三角形（纯填充导出）',
    d: 'M80 180 L240 180 L160 50 Z',
    style: {
      width: 18,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 8,
    },
  },
  {
    id: 'round-join-curve',
    title: '圆角连接与圆角端帽（折线）',
    d: 'M40 190 L120 70 L200 160 L280 60',
    style: {
      width: 16,
      lineCap: 'round',
      lineJoin: 'round',
      miterLimit: 4,
    },
  },
];

module.exports = { cases, VIEWBOX };
