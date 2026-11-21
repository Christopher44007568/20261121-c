// Minimal SVG path / polyline outline importer.
// Supported commands: M m L l H h V v C c S s Q q T t Z z (A a -> flattened).
// Curves are flattened here so the baker only deals with straight segments.

import { flattenCubic, flattenQuad, vec } from './geometry.js';

const TOKEN_RE = /[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g;

export function parsePathData(d, flatnessTol = 0.05) {
  const tokens = d.match(TOKEN_RE) ?? [];
  const contours = [];
  let contour = null;
  let start = null;
  let cur = null;
  let lastCtrl = null; // for smooth S/T
  let lastCmd = '';
  let i = 0;

  const num = () => parseFloat(tokens[i++]);
  const ensure = () => {
    if (!contour) {
      contour = { points: [] };
      contours.push(contour);
    }
  };
  const moveTo = (p) => {
    contour = { points: [p] };
    contours.push(contour);
    start = p;
    cur = p;
    lastCtrl = null;
  };
  const lineTo = (p) => {
    ensure();
    contour.points.push(p);
    cur = p;
  };
  const cubicTo = (c1, c2, p1) => {
    ensure();
    const pts = flattenCubic(cur, c1, c2, p1, flatnessTol);
    for (const p of pts) contour.points.push(p);
    cur = p1;
  };
  const quadTo = (c, p1) => {
    ensure();
    const pts = flattenQuad(cur, c, p1, flatnessTol);
    for (const p of pts) contour.points.push(p);
    cur = p1;
  };

  while (i < tokens.length) {
    const cmd = tokens[i++];
    const rel = cmd >= 'a' && cmd <= 'z';
    const C = cmd.toUpperCase();
    const map = (x, y) => (rel && cur ? vec(cur.x + x, cur.y + y) : vec(x, y));

    if (C === 'M') {
      moveTo(map(num(), num()));
      // Implicit lineto points after M
      while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) lineTo(map(num(), num()));
    } else if (C === 'L') {
      do lineTo(map(num(), num()));
      while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'H') {
      do {
        const x = num();
        lineTo(vec(rel ? cur.x + x : x, cur.y));
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'V') {
      do {
        const y = num();
        lineTo(vec(cur.x, rel ? cur.y + y : y));
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'C') {
      do {
        const c1 = map(num(), num());
        const c2 = map(num(), num());
        const p1 = map(num(), num());
        cubicTo(c1, c2, p1);
        lastCtrl = c2;
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'S') {
      do {
        const c1 = lastCtrl && /[CS]/.test(lastCmd)
          ? vec(2 * cur.x - lastCtrl.x, 2 * cur.y - lastCtrl.y)
          : vec(cur.x, cur.y);
        const c2 = map(num(), num());
        const p1 = map(num(), num());
        cubicTo(c1, c2, p1);
        lastCtrl = c2;
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'Q') {
      do {
        const c = map(num(), num());
        const p1 = map(num(), num());
        quadTo(c, p1);
        lastCtrl = c;
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'T') {
      do {
        const c = lastCtrl && /[QT]/.test(lastCmd)
          ? vec(2 * cur.x - lastCtrl.x, 2 * cur.y - lastCtrl.y)
          : vec(cur.x, cur.y);
        const p1 = map(num(), num());
        quadTo(c, p1);
        lastCtrl = c;
      } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
    } else if (C === 'A') {
      // Arcs are uncommon in glyph test data; skip their 7 params explicitly.
      i += 7;
      lineTo(map(0, 0));
    } else if (C === 'Z') {
      if (contour && contour.points.length > 1) {
        const first = contour.points[0];
        const last = contour.points[contour.points.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
          contour.points.pop();
        }
      }
      cur = start;
      contour = null;
      lastCtrl = null;
    }
    lastCmd = C;
  }

  return { contours: contours.filter((c) => c.points.length >= 3) };
}

// Parse the simple polyline JSON format, see web/sample-glyphs.js for examples.
export function parseOutlineJson(data, unitScale = 1) {
  const shape = typeof data === 'string' ? JSON.parse(data) : data;
  const contours = shape.contours.map((c) => ({
    points: c.points.map((p) => vec(p[0] * unitScale, p[1] * unitScale)),
  }));
  return { name: shape.name, contours };
}
