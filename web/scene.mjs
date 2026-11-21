// 浏览器端场景，与 src/scene.js 同构
export const W = 760;
export const H = 480;

function V(clipPos, window, ndcZ, color, alpha = 1) {
  return { pos: clipPos, window, ndcZ, attr: { invW: 1, color, alpha } };
}
function makeV(wx, wy, ndcZ, color, alpha = 1) {
  const ndcX = (wx / W) * 2 - 1;
  const ndcY = 1 - (wy / H) * 2;
  return V([ndcX, ndcY, ndcZ, 1], [wx, wy], ndcZ, color, alpha);
}
function makeV4(wx, wy, clipX, clipY, clipZ, clipW, color, alpha = 1) {
  const v = V([clipX, clipY, clipZ, clipW], [wx, wy], clipZ / clipW, color, alpha);
  v.attr.invW = 1 / clipW;
  return v;
}

export const triangles = [
  {
    id: 'T0', label: '共享边 · 保留侧',
    vertices: [
      makeV(200, 285.5, 0.25, [255, 120, 40]),
      makeV(401, 285.5, 0.25, [255, 224, 120]),
      makeV(360.37, 90.61, 0.25, [255, 176, 90]),
    ],
  },
  {
    id: 'T1', label: '共享边 · top-left 排除侧',
    vertices: [
      makeV(401, 285.5, 0.10, [70, 130, 220]),
      makeV(200, 285.5, 0.10, [120, 180, 250]),
      makeV(300.41, 420.53, 0.10, [40, 90, 190]),
    ],
  },
  {
    id: 'T2', label: '等深竞争 · 先绘制',
    vertices: [
      makeV(437, 360, -0.18, [237, 108, 166]),
      makeV(684, 360, -0.18, [250, 150, 190]),
      makeV(570, 168, -0.18, [210, 80, 150]),
    ],
  },
  {
    id: 'T3', label: '等深竞争 · 后绘制',
    vertices: [
      makeV(456.29, 372.43, -0.18, [90, 200, 170]),
      makeV(703.31, 312.57, -0.18, [140, 230, 200]),
      makeV(532.67, 192.23, -0.18, [60, 170, 150]),
    ],
  },
  {
    id: 'T4', label: '近面 + 下平面裁剪',
    vertices: [
      makeV4(399.31, 432.47, ((399.31 / W) * 2 - 1) * 2, (1 - (432.47 / H) * 2) * 2, -2.5, 2, [40, 150, 90]),
      makeV(551.43, 432.29, 0.30, [90, 200, 120]),
      makeV(475.59, 324.37, 0.30, [60, 170, 100]),
    ],
  },
  {
    id: 'T5', label: '半透明 · 源 Alpha 覆盖',
    vertices: [
      makeV(340.51, 220.63, -0.65, [80, 165, 220], 0.62),
      makeV(390.37, 90.29, -0.65, [120, 200, 240], 0.62),
      makeV(250.43, 80.57, -0.65, [91, 180, 229], 0.62),
    ],
  },
];

export const scene = { width: W, height: H, clearColor: [8, 13, 21, 255], triangles };

export const CHECK_POINTS = [
  { id: 'edge', pixel: [300, 285], name: '共享边' },
  { id: 'near', pixel: [510, 380], name: '近面裁剪' },
  { id: 'equal', pixel: [579, 251], name: '等深竞争' },
  { id: 'blend', pixel: [320, 145], name: '透明混合' },
];
