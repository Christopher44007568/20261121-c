// Parse an SVG path `d` string into a list of subpaths.
// Each subpath: { closed: boolean, segments: Segment[] }
// Segment shapes (all in absolute user units):
//   { type: 'L', from, to }
//   { type: 'C', from, c1, c2, to }
//   { type: 'Q', from, c, to }
//   { type: 'A', from, rx, ry, xAxisRotation, largeArc, sweep, to }
// Zero-length moveto-only subpaths are preserved as { closed:false, segments:[] , start }.

'use strict';

const COMMAND_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

function tokenize(d) {
  const tokens = [];
  const re = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function isCommand(token) {
  return COMMAND_RE.test(token);
}

function parsePath(d) {
  const tokens = tokenize(d);
  const subpaths = [];
  let current = null;
  let cursor = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastControl = null; // for S/T reflection
  let lastCommand = null;
  let index = 0;

  function readNumber() {
    const token = tokens[index];
    if (token === undefined || isCommand(token)) {
      throw new Error(`missing number at token ${index}`);
    }
    index += 1;
    return parseFloat(token);
  }

  function readPoint(relative) {
    const x = readNumber();
    const y = readNumber();
    if (relative) return { x: cursor.x + x, y: cursor.y + y };
    return { x, y };
  }

  function openSubpath(point) {
    current = { start: point, closed: false, segments: [] };
    subpaths.push(current);
    start = point;
    cursor = { ...point };
  }

  while (index < tokens.length) {
    let command = tokens[index];
    if (!isCommand(command)) {
      // Implicit repeat: lineto after moveto, else same command.
      command = lastCommand === 'M' ? 'L' : lastCommand === 'm' ? 'l' : lastCommand;
    } else {
      index += 1;
    }
    const relative = command === command.toLowerCase() && command !== 'Z' && command !== 'z';
    const upper = command.toUpperCase();

    if (upper === 'M') {
      const point = readPoint(relative);
      openSubpath(point);
      lastControl = null;
    } else if (upper === 'L') {
      const to = readPoint(relative);
      current.segments.push({ type: 'L', from: { ...cursor }, to });
      cursor = to;
      lastControl = null;
    } else if (upper === 'H') {
      const value = readNumber();
      const to = { x: relative ? cursor.x + value : value, y: cursor.y };
      current.segments.push({ type: 'L', from: { ...cursor }, to });
      cursor = to;
      lastControl = null;
    } else if (upper === 'V') {
      const value = readNumber();
      const to = { x: cursor.x, y: relative ? cursor.y + value : value };
      current.segments.push({ type: 'L', from: { ...cursor }, to });
      cursor = to;
      lastControl = null;
    } else if (upper === 'C') {
      const c1 = readPoint(relative);
      const c2 = readPoint(relative);
      const to = readPoint(relative);
      current.segments.push({ type: 'C', from: { ...cursor }, c1, c2, to });
      cursor = to;
      lastControl = c2;
    } else if (upper === 'S') {
      const c2 = readPoint(relative);
      const to = readPoint(relative);
      const c1 = lastControl
        ? { x: 2 * cursor.x - lastControl.x, y: 2 * cursor.y - lastControl.y }
        : { ...cursor };
      current.segments.push({ type: 'C', from: { ...cursor }, c1, c2, to });
      cursor = to;
      lastControl = c2;
    } else if (upper === 'Q') {
      const c = readPoint(relative);
      const to = readPoint(relative);
      current.segments.push({ type: 'Q', from: { ...cursor }, c, to });
      cursor = to;
      lastControl = c;
    } else if (upper === 'T') {
      const to = readPoint(relative);
      const c = lastControl
        ? { x: 2 * cursor.x - lastControl.x, y: 2 * cursor.y - lastControl.y }
        : { ...cursor };
      current.segments.push({ type: 'Q', from: { ...cursor }, c, to });
      cursor = to;
      lastControl = c;
    } else if (upper === 'A') {
      const rx = readNumber();
      const ry = readNumber();
      const xAxisRotation = readNumber();
      const largeArc = readNumber() !== 0;
      const sweep = readNumber() !== 0;
      const to = readPoint(relative);
      current.segments.push({
        type: 'A',
        from: { ...cursor },
        rx,
        ry,
        xAxisRotation,
        largeArc,
        sweep,
        to,
      });
      cursor = to;
      lastControl = null;
    } else if (upper === 'Z') {
      current.closed = true;
      if (current.segments.length && (current.segments[current.segments.length - 1].to.x !== start.x ||
        current.segments[current.segments.length - 1].to.y !== start.y)) {
        current.segments.push({ type: 'L', from: { ...cursor }, to: { ...start } });
      }
      cursor = { ...start };
      lastControl = null;
    } else {
      throw new Error(`unsupported command ${command}`);
    }
    lastCommand = command;
  }
  return subpaths;
}

module.exports = { parsePath, tokenize };
