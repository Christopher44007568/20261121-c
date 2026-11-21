'use strict';
// 独立参考实现：与 src/rasterizer.js 走不同代码路径（标量 NDC 反算 + 重心深度），
// 用于全帧缓冲逐像素对照，充当离屏 GPU 参考。
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function clipOne(poly, plane) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const dA = plane.f(A), dB = plane.f(B);
    if (dA >= 0 && dB >= 0) out.push(B);
    else if (dA >= 0 && dB < 0) out.push(interp(B, A, dB / (dB - dA)));
    else if (dA < 0 && dB >= 0) { out.push(interp(A, B, dA / (dA - dB))); out.push(B); }
  }
  return out;
}
function interp(A, B, t) {
  const pos = A.pos.map((c, i) => c + (B.pos[i] - c) * t);
  const attr = {};
  for (const k of Object.keys(A.attr)) {
    attr[k] = Array.isArray(A.attr[k])
      ? A.attr[k].map((c, i) => c + (B.attr[k][i] - c) * t)
      : A.attr[k] + (B.attr[k] - A.attr[k]) * t;
  }
  attr.invW = 1 / pos[3];
  const [vw, vh] = A.viewport;
  const invW = 1 / pos[3];
  const win = [
    (pos[0] * invW * 0.5 + 0.5) * vw,
    (1 - (pos[1] * invW * 0.5 + 0.5)) * vh,
  ];
  return { pos, window: win, ndcZ: pos[2] / pos[3], attr };
}

const PLANES = [
  { name: 'left', f: (v) => v.pos[0] + v.pos[3] },
  { name: 'right', f: (v) => -v.pos[0] + v.pos[3] },
  { name: 'bottom', f: (v) => v.pos[1] + v.pos[3] },
  { name: 'top', f: (v) => -v.pos[1] + v.pos[3] },
  { name: 'near', f: (v) => v.pos[2] + v.pos[3] },
  { name: 'far', f: (v) => -v.pos[2] + v.pos[3] },
];

function referenceRender(scene) {
  const { width: W, height: H } = scene;
  const color = new Uint8ClampedArray(W * H * 4);
  const depth = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) { color.set(scene.clearColor, i * 4); depth[i] = 1; }

  for (const tri of scene.triangles) {
    let poly = tri.vertices.map((v) => ({ ...v, viewport: [W, H] }));
    for (const pl of PLANES) poly = clipOne(poly, pl);
    for (let f = 1; f + 1 < poly.length; f++) {
      const V = [poly[0], poly[f], poly[f + 1]];
      const p = V.map((v) => ({ x: v.window[0], y: v.window[1], ndcZ: v.ndcZ,
        c: v.attr.color, a: v.attr.alpha, iw: v.attr.invW }));
      const minX = Math.max(0, Math.floor(Math.min(p[0].x, p[1].x, p[2].x)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0].x, p[1].x, p[2].x)) - 1);
      const minY = Math.max(0, Math.floor(Math.min(p[0].y, p[1].y, p[2].y)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(p[0].y, p[1].y, p[2].y)) - 1);
      const area = edge(p[0], p[1], p[2]);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const s = { x: x + 0.5, y: y + 0.5 };
          const e01 = edge(p[0], p[1], s);
          const e12 = edge(p[1], p[2], s);
          const e20 = edge(p[2], p[0], s);
          const inside = [e01, e12, e20].every((e, i) => {
            if (e > 0) return true;
            if (e < 0) return false;
            const a = p[i], b = p[(i + 1) % 3];
            const dy = b.y - a.y, dx = b.x - a.x;
            return dy < 0 || (dy === 0 && dx > 0);
          });
          if (!inside) continue;
          const w0 = e12 / area, w1 = e20 / area, w2 = e01 / area;
          const iw = w0 * p[0].iw + w1 * p[1].iw + w2 * p[2].iw;
          const g = [w0 * p[0].iw, w1 * p[1].iw, w2 * p[2].iw].map((q) => q / iw);
          // 窗口深度按屏幕重心线性插值（与 GPU 视口深度一致）
          const flatZ = p[0].ndcZ === p[1].ndcZ && p[1].ndcZ === p[2].ndcZ;
          const ndcZ = flatZ ? p[0].ndcZ : w0 * p[0].ndcZ + w1 * p[1].ndcZ + w2 * p[2].ndcZ;
          const z = ndcZ * 0.5 + 0.5;
          const idx = y * W + x;
          if (!(z < depth[idx])) continue;
          depth[idx] = z;
          const src = [0, 1, 2].map((c) => g[0] * p[0].c[c] + g[1] * p[1].c[c] + g[2] * p[2].c[c]);
          const alpha = g[0] * p[0].a + g[1] * p[1].a + g[2] * p[2].a;
          for (let c = 0; c < 3; c++) {
            color[idx * 4 + c] = clamp255(src[c] * alpha + color[idx * 4 + c] * (1 - alpha));
          }
        }
      }
    }
  }
  return { color, depth };
}
function edge(a, b, p) { return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x); }
function topLeftOK(p, s) {
  for (let i = 0; i < 3; i++) {
    const a = p[i], b = p[(i + 1) % 3];
    const e = edge(a, b, s);
    if (e === 0) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const tl = dy < 0 || (dy === 0 && dx > 0);
      if (!tl) return false;
    }
  }
  return true;
}

module.exports = { referenceRender };
