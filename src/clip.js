'use strict';

// 视锥六个平面（齐次空间），inside: a*x+b*y+c*z+d*w >= 0
const PLANES = [
  { name: 'left',   a: 1, b: 0, c: 0, d: 1 },
  { name: 'right',  a: -1, b: 0, c: 0, d: 1 },
  { name: 'bottom', a: 0, b: 1, c: 0, d: 1 },
  { name: 'top',    a: 0, b: -1, c: 0, d: 1 },
  { name: 'near',   a: 0, b: 0, c: 1, d: 1 },
  { name: 'far',    a: 0, b: 0, c: -1, d: 1 },
];

function signedDistance(v, plane) {
  return plane.a * v.pos[0] + plane.b * v.pos[1] +
         plane.c * pos_z(v) + plane.d * v.pos[3];
}
function pos_z(v) { return v.pos[2]; }

function lerpAttr(a, b, t) {
  const out = {};
  for (const key of Object.keys(a)) {
    const av = a[key];
    if (Array.isArray(av)) out[key] = av.map((x, i) => x + (b[key][i] - x) * t);
    else out[key] = av + (b[key] - av) * t;
  }
  return out;
}

// 视口变换：NDC -> 窗口像素
function projectWindow(pos, width, height) {
  const invW = 1 / pos[3];
  return [
    (pos[0] * invW * 0.5 + 0.5) * width,
    (1 - (pos[1] * invW * 0.5 + 0.5)) * height,
  ];
}

function interpolateVertex(inside, outside, t) {
  const pos = inside.pos.map((c, i) => c + (outside.pos[i] - c) * t);
  const attr = lerpAttr(inside.attr, outside.attr, t);
  // 透视正确：裁剪新顶点的 1/w 由齐次 w 重新计算
  attr.invW = 1 / pos[3];
  // 窗口坐标由插值后的齐次位置重新投影，与 GPU 裁剪后投影完全一致
  const window = projectWindow(pos, inside.viewport[0], inside.viewport[1]);
  return {
    pos,
    window,
    ndcZ: pos[2] / pos[3],
    attr,
  };
}

// 对单个凸多边形依次裁剪；返回 { polygon, planesHit }
function clipPolygon(polygon, planes) {
  let current = polygon;
  const planesHit = [];
  for (const plane of planes) {
    if (current.length === 0) break;
    const next = [];
    let hit = false;
    for (let i = 0; i < current.length; i++) {
      const A = current[i];
      const B = current[(i + 1) % current.length];
      const dA = signedDistance(A, plane);
      const dB = signedDistance(B, plane);
      const inA = dA >= 0;
      const inB = dB >= 0;
      if (inA !== inB) {
        hit = true;
        const t = dA / (dA - dB);
        // t 始终是从 A 走向 B 的参数，因此插值起点固定为 A
        next.push(interpolateVertex(A, B, t));
      }
      if (inB) next.push(B);
    }
    if (hit) planesHit.push(plane.name);
    current = next;
  }
  return { polygon: current, planesHit };
}

// 三角形 -> 裁剪后的三角形扇（保留原始顶点属性，含 1/w 与颜色）
function clipTriangle(vertices, viewport) {
  const withViewport = vertices.map((v) => ({ ...v, viewport }));
  const result = clipPolygon(withViewport, PLANES);
  const tris = [];
  const poly = result.polygon;
  for (let i = 1; i + 1 < poly.length; i++) {
    tris.push([poly[0], poly[i], poly[i + 1]]);
  }
  return { triangles: tris, polygonSize: poly.length, planesHit: result.planesHit };
}

module.exports = { PLANES, clipPolygon, clipTriangle };
