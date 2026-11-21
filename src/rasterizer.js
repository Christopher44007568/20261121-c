'use strict';

const { clipTriangle } = require('./clip');

// 边函数（面积 ×2），点为 {x, y} 或 [x, y]
function xy(p) {
  return Array.isArray(p) ? p : [p.x, p.y];
}

function edgeFunction(a, b, p) {
  const pa = xy(a), pb = xy(b), pp = xy(p);
  return (pp[0] - pa[0]) * (pb[1] - pa[1]) - (pp[1] - pa[1]) * (pb[0] - pa[0]);
}

// D3D/GL 风格 top-left 规则：
// 水平边（dy==0 且 dx>0）或逆时针边（dy<0）为 top/left，落在其上的采样点保留。
function isTopLeft(a, b) {
  const pa = xy(a), pb = xy(b);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  return dy < 0 || (dy === 0 && dx > 0);
}

// 裁剪后的顶点已携带插值好的窗口坐标与 1/w
function toWindow(v) {
  return {
    x: v.window[0],
    y: v.window[1],
    ndcZ: v.ndcZ,
    invW: v.attr.invW,
    color: v.attr.color,
    alpha: v.attr.alpha,
  };
}

function bbox(verts) {
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  return {
    minX: Math.max(0, Math.floor(Math.min(...xs))),
    maxX: Math.ceil(Math.max(...xs)) - 1,
    minY: Math.max(0, Math.floor(Math.min(...ys))),
    maxY: Math.ceil(Math.max(...ys)) - 1,
  };
}

// 透视正确的属性插值：屏幕重心 λ -> 世界重心 (λ_i / w_i) / Σ
function perspectiveWeights(bary, invWs) {
  const scaled = bary.map((l, i) => l * invWs[i]);
  const sum = scaled[0] + scaled[1] + scaled[2];
  return scaled.map((s) => s / sum);
}

function lerpColor(weights, colors) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 3; i++) out[c] += weights[i] * colors[i][c];
  }
  return out;
}

function createFramebuffer(width, height, clearColor) {
  const color = new Uint8ClampedArray(width * height * 4);
  const depth = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    color.set(clearColor, i * 4);
    depth[i] = 1;
  }
  return { width, height, color, depth };
}

// 主光栅化器；pixelHistory 为 Map(key -> 事件数组)，可选
function render(scene, opts = {}) {
  const { width, height } = scene;
  const fb = createFramebuffer(width, height, scene.clearColor);
  const history = new Map();
  const stats = { triangles: scene.triangles.length, clipped: 0, fragments: 0, shaded: 0 };
  const trace = opts.tracePoints || [];
  const traces = trace.map((p) => ({
    x: p[0], y: p[1], attempts: [], events: [],
  }));

  scene.triangles.forEach((tri, order) => {
    const clipResult = clipTriangle(tri.vertices, [width, height]);
    if (clipResult.polygonSize !== 3) stats.clipped += 1;
    // 为追踪点预建该图元的覆盖尝试，保证 6 个图元都出现在历史中
    traces.forEach((tr) => {
      tr.attempts.push({
        triangleId: tri.id, label: tri.label, order,
        planesHit: clipResult.planesHit, clipPolygon: clipResult.polygonSize,
        covered: false, reason: 'outside', edges: null,
      });
    });
    if (clipResult.triangles.length === 0) return;

    for (const clippedTri of clipResult.triangles) {
      const wv = clippedTri.map((vertex) => toWindow(vertex));
      const box = bbox(wv);
      box.maxX = Math.min(width - 1, box.maxX);
      box.maxY = Math.min(height - 1, box.maxY);
      if (box.minX > box.maxX || box.minY > box.maxY) continue;

      const area = edgeFunction(wv[0], wv[1], wv[2]);
      if (area === 0) continue;
      const tls = [
        isTopLeft(wv[0], wv[1]),
        isTopLeft(wv[1], wv[2]),
        isTopLeft(wv[2], wv[0]),
      ];
      const invWs = wv.map((v) => v.invW);
      const colors = wv.map((v) => v.color);
      const alphas = wv.map((v) => v.alpha);

      for (let py = box.minY; py <= box.maxY; py++) {
        for (let px = box.minX; px <= box.maxX; px++) {
          stats.fragments += 1;
          const sample = [px + 0.5, py + 0.5];
          const e01 = edgeFunction(wv[0], wv[1], sample);
          const e12 = edgeFunction(wv[1], wv[2], sample);
          const e20 = edgeFunction(wv[2], wv[0], sample);
          const edges = [e01, e12, e20];
          const edgeStates = edges.map((value, i) => ({
            edge: ['v0→v1', 'v1→v2', 'v2→v0'][i],
            value,
            topLeft: tls[i],
            accepted: value > 0 || (value === 0 && tls[i]),
          }));
          const covered = edgeStates.every((s) => s.accepted);

          // 记录追踪点的覆盖尝试
          traces.forEach((tr, ti) => {
            if (tr.x === px && tr.y === py) {
              const strictlyOutside = e01 < 0 || e12 < 0 || e20 < 0;
              const slot = tr.attempts.find((a) => a.order === order);
              Object.assign(slot, {
                triangleId: tri.id, label: tri.label, order,
                planesHit: clipResult.planesHit, clipPolygon: clipResult.polygonSize,
                covered, reason: covered ? null : (strictlyOutside ? 'outside' : 'edge'),
                edges: edgeStates,
              });
            }
          });
          if (!covered) continue;

          const bary = [e12 / area, e20 / area, e01 / area];
          const weights = perspectiveWeights(bary, invWs);
          const srcRgb = lerpColor(weights, colors);
          const alpha = weights[0] * alphas[0] + weights[1] * alphas[1] + weights[2] * alphas[2];
          const invW = bary[0] * invWs[0] + bary[1] * invWs[1] + bary[2] * invWs[2];
          // 平面（恒定深度）三角形直接取顶点值，保证等深竞争逐位一致，
          // 与 GPU 的 flat-depth 快速路径行为对齐
          const flatZ = wv[0].ndcZ === wv[1].ndcZ && wv[1].ndcZ === wv[2].ndcZ;
          const ndcZ = flatZ ? wv[0].ndcZ
            : bary[0] * wv[0].ndcZ + bary[1] * wv[1].ndcZ + bary[2] * wv[2].ndcZ;
          const winZ = ndcZ * 0.5 + 0.5;

          stats.shaded += 1;
          const idx = py * width + px;
          const prevDepth = fb.depth[idx];
          const pass = winZ < prevDepth;
          const prevColor = Array.from(fb.color.slice(idx * 4, idx * 4 + 4));

          const event = {
            triangleId: tri.id, label: tri.label, order,
            clipPolygon: clipResult.polygonSize, planesHit: clipResult.planesHit,
            edgeStates, screenBarycentric: bary, inverseW: invW,
            perspectiveWeights: weights, interpolatedColor: srcRgb, alpha,
            depth: { ndc: ndcZ, window: winZ, previous: prevDepth, pass },
            blended: false, previousColor: prevColor, result: prevColor.slice(),
          };

          if (pass) {
            fb.depth[idx] = winZ;
            const sr = srcRgb[0], sg = srcRgb[1], sb = srcRgb[2];
            const dr = prevColor[0], dg = prevColor[1], db = prevColor[2];
            // SRC_ALPHA / ONE_MINUS_SRC_ALPHA；不写透明 Alpha
            const rr = sr * alpha + dr * (1 - alpha);
            const rg = sg * alpha + dg * (1 - alpha);
            const rb = sb * alpha + db * (1 - alpha);
            fb.color[idx * 4] = rr;
            fb.color[idx * 4 + 1] = rg;
            fb.color[idx * 4 + 2] = rb;
            event.blended = true;
            event.result = Array.from(fb.color.slice(idx * 4, idx * 4 + 4));
          }

          if (!history.has(idx)) history.set(idx, []);
          history.get(idx).push(event);
          traces.forEach((tr) => {
            if (tr.x === px && tr.y === py) tr.events.push(event);
          });
        }
      }
    }
  });

  traces.forEach((tr) => {
    tr.sample = [tr.x + 0.5, tr.y + 0.5];
    const idx = tr.y * width + tr.x;
    tr.final = Array.from(fb.color.slice(idx * 4, idx * 4 + 4));
    tr.depth = fb.depth[idx];
  });

  return { framebuffer: fb, history, stats, traces };
}

module.exports = {
  edgeFunction, isTopLeft, toWindow, perspectiveWeights,
  createFramebuffer, render, bbox,
};
