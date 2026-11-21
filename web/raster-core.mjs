// 浏览器 ESM 版光栅化内核，与 src/ 下 Node 实现保持同一套数学。
// 齐次裁剪 -> top-left 覆盖 -> 透视正确插值 -> LESS 深度 -> SRC_ALPHA 混合。
import { W, H } from './scene.mjs';

const PLANES = [
  { name: 'left', a: 1, b: 0, c: 0, d: 1 },
  { name: 'right', a: -1, b: 0, c: 0, d: 1 },
  { name: 'bottom', a: 0, b: 1, c: 0, d: 1 },
  { name: 'top', a: 0, b: -1, c: 0, d: 1 },
  { name: 'near', a: 0, b: 0, c: 1, d: 1 },
  { name: 'far', a: 0, b: 0, c: -1, d: 1 },
];

const sd = (v, p) => p.a * v.pos[0] + p.b * v.pos[1] + p.c * v.pos[2] + p.d * v.pos[3];

function lerpAttr(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = Array.isArray(a[k]) ? a[k].map((x, i) => x + (b[k][i] - x) * t) : a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

function interpVertex(A, B, t) {
  const pos = A.pos.map((c, i) => c + (B.pos[i] - c) * t);
  const attr = lerpAttr(A.attr, B.attr, t);
  attr.invW = 1 / pos[3];
  const invW = 1 / pos[3];
  const [vw, vh] = A.viewport;
  const win = [
    (pos[0] * invW * 0.5 + 0.5) * vw,
    (1 - (pos[1] * invW * 0.5 + 0.5)) * vh,
  ];
  return { pos, window: win, ndcZ: pos[2] * invW, attr };
}

function clipPolygon(polygon) {
  let cur = polygon;
  const planesHit = [];
  for (const plane of PLANES) {
    if (!cur.length) break;
    const next = [];
    let hit = false;
    for (let i = 0; i < cur.length; i++) {
      const A = cur[i], B = cur[(i + 1) % cur.length];
      const dA = sd(A, plane), dB = sd(B, plane);
      const inA = dA >= 0, inB = dB >= 0;
      if (inA !== inB) { hit = true; next.push(interpVertex(A, B, dA / (dA - dB))); }
      if (inB) next.push(B);
    }
    if (hit) planesHit.push(plane.name);
    cur = next;
  }
  return { polygon: cur, planesHit };
}

function clipTriangle(verts, viewport) {
  const withViewport = verts.map((v) => ({ ...v, viewport }));
  const { polygon, planesHit } = clipPolygon(withViewport);
  const triangles = [];
  for (let i = 1; i + 1 < polygon.length; i++) triangles.push([polygon[0], polygon[i], polygon[i + 1]]);
  return { triangles, polygonSize: polygon.length, planesHit };
}

const xy = (p) => (Array.isArray(p) ? p : [p.x, p.y]);
function edgeFn(a, b, p) {
  const A = xy(a), B = xy(b), P = xy(p);
  return (P[0] - A[0]) * (B[1] - A[1]) - (P[1] - A[1]) * (B[0] - A[0]);
}
function topLeft(a, b) {
  const A = xy(a), B = xy(b);
  const dy = B[1] - A[1], dx = B[0] - A[0];
  return dy < 0 || (dy === 0 && dx > 0);
}
function toWindow(v) {
  return { x: v.window[0], y: v.window[1], ndcZ: v.ndcZ, invW: v.attr.invW, color: v.attr.color, alpha: v.attr.alpha };
}
function perspWeights(bary, invWs) {
  const s = bary.map((l, i) => l * invWs[i]);
  const sum = s.reduce((a, b) => a + b, 0);
  return s.map((x) => x / sum);
}

export function render(scene, tracePoints = []) {
  const { width: W, height: H } = scene;
  const color = new Uint8ClampedArray(W * H * 4);
  const depth = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) { color.set(scene.clearColor, i * 4); depth[i] = 1; }
  const history = new Map();
  const stats = { triangles: scene.triangles.length, clipped: 0, fragments: 0, shaded: 0 };
  const traces = tracePoints.map(([x, y]) => ({ x, y, attempts: [], events: [] }));

  scene.triangles.forEach((tri, order) => {
    const clip = clipTriangle(tri.vertices, [W, H]);
    if (clip.polygonSize !== 3) stats.clipped++;
    for (const tr of traces) tr.attempts.push({
      triangleId: tri.id, label: tri.label, order, planesHit: clip.planesHit,
      clipPolygon: clip.polygonSize, covered: false, reason: 'outside', edges: null,
    });
    for (const ct of clip.triangles) {
      const wv = ct.map(toWindow);
      const minX = Math.max(0, Math.floor(Math.min(...wv.map((v) => v.x))));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(...wv.map((v) => v.x))) - 1);
      const minY = Math.max(0, Math.floor(Math.min(...wv.map((v) => v.y))));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(...wv.map((v) => v.y))) - 1);
      if (minX > maxX || minY > maxY) continue;
      const area = edgeFn(wv[0], wv[1], wv[2]);
      if (area === 0) continue;
      const tls = [topLeft(wv[0], wv[1]), topLeft(wv[1], wv[2]), topLeft(wv[2], wv[0])];
      const invWs = wv.map((v) => v.invW);
      const colors = wv.map((v) => v.color);
      const alphas = wv.map((v) => v.alpha);

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          stats.fragments++;
          const sample = [px + 0.5, py + 0.5];
          const raw = [edgeFn(wv[0], wv[1], sample), edgeFn(wv[1], wv[2], sample), edgeFn(wv[2], wv[0], sample)];
          const edgeStates = raw.map((value, i) => ({
            edge: ['v0→v1', 'v1→v2', 'v2→v0'][i], value, topLeft: tls[i],
            accepted: value > 0 || (value === 0 && tls[i]),
          }));
          const covered = edgeStates.every((s) => s.accepted);
          for (const tr of traces) {
            if (tr.x === px && tr.y === py) {
              const outside = raw.some((e) => e < 0);
              Object.assign(tr.attempts.find((a) => a.order === order), {
                covered, reason: covered ? null : outside ? 'outside' : 'edge', edges: edgeStates,
              });
            }
          }
          if (!covered) continue;

          const bary = [raw[1] / area, raw[2] / area, raw[0] / area];
          const weights = perspWeights(bary, invWs);
          const srcRgb = [0, 1, 2].map((c) => weights.reduce((acc, w, i) => acc + w * colors[i][c], 0));
          const alpha = weights.reduce((acc, w, i) => acc + w * alphas[i], 0);
          const invW = bary.reduce((acc, l, i) => acc + l * invWs[i], 0);
          const flatZ = wv[0].ndcZ === wv[1].ndcZ && wv[1].ndcZ === wv[2].ndcZ;
          const ndcZ = flatZ ? wv[0].ndcZ : bary.reduce((acc, l, i) => acc + l * wv[i].ndcZ, 0);
          const winZ = ndcZ * 0.5 + 0.5;

          stats.shaded++;
          const idx = py * W + px;
          const prevDepth = depth[idx];
          const pass = winZ < prevDepth;
          const previousColor = Array.from(color.slice(idx * 4, idx * 4 + 4));
          const event = {
            triangleId: tri.id, label: tri.label, order, clipPolygon: clip.polygonSize,
            planesHit: clip.planesHit, edgeStates, screenBarycentric: bary, inverseW: invW,
            perspectiveWeights: weights, interpolatedColor: srcRgb, alpha,
            depth: { ndc: ndcZ, window: winZ, previous: prevDepth, pass },
            blended: false, previousColor, result: previousColor.slice(),
          };
          if (pass) {
            depth[idx] = winZ;
            for (let c = 0; c < 3; c++) {
              color[idx * 4 + c] = srcRgb[c] * alpha + previousColor[c] * (1 - alpha);
            }
            event.blended = true;
            event.result = Array.from(color.slice(idx * 4, idx * 4 + 4));
          }
          if (!history.has(idx)) history.set(idx, []);
          history.get(idx).push(event);
          for (const tr of traces) if (tr.x === px && tr.y === py) tr.events.push(event);
        }
      }
    }
  });
  for (const tr of traces) {
    tr.sample = [tr.x + 0.5, tr.y + 0.5];
    const idx = tr.y * W + tr.x;
    tr.final = Array.from(color.slice(idx * 4, idx * 4 + 4));
    tr.depth = depth[idx];
  }
  return { color, depth, history, stats, traces };
}
