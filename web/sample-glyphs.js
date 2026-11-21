// Built-in test glyphs. All use EM units with the origin at the glyph center.
// Outer contours are CCW, holes are CW so the nonzero rule subtracts them.

export const SAMPLE_GLYPHS = [
  {
    id: 'needle',
    label: '锐角针形 (acute spike)',
    description: '顶部极锐角，单通道 SDF 在放大/斜视下会削平尖端，MSDF 多通道 median 保持锐利。',
    path: 'M-10,-12 L10,-12 L0.3,16 L0,17 L-0.3,16 Z',
  },
  {
    id: 'slot-cross',
    label: '窄洞十字 (narrow holes)',
    description: '两条 2.2 EM 宽的狭长内孔，宽度低于 2 个纹理像素时 SDF 孔洞塌缩。',
    path: [
      'M-20,-20 L20,-20 L20,20 L-20,20 Z',
      // CW vertical slot
      'M-1.1,-15 L-1.1,15 L1.1,15 L1.1,-15 Z',
      // CW horizontal slot
      'M-15,-1.1 L15,-1.1 L15,1.1 L-15,1.1 Z',
    ].join(' '),
  },
  {
    id: 'overlap',
    label: '重叠轮廓 (overlapping outlines)',
    description: '两个同向重叠方块：nonzero 规则取并集，even-odd 规则挖去交集。',
    path: [
      'M-15,-10 L5,-10 L5,10 L-15,10 Z',
      'M-5,-10 L15,-10 L15,10 L-5,10 Z',
    ].join(' '),
  },
  {
    id: 'curved-a',
    label: '曲线 + 洞 (curved counter)',
    description: '三次贝塞尔外轮廓配 CW 内孔，验证曲线展开与洞的组合。',
    path: [
      'M-12,-14 C-22,2 -18,18 0,18 C18,18 22,2 12,-14 C8,-20 -8,-20 -12,-14 Z',
      'M-4,-6 C-8,2 -6,10 0,10 C6,10 8,2 4,-6 C2,-10 -2,-10 -4,-6 Z',
    ].join(' '),
  },
];

// Polyline JSON example shown in the import dialog, also accepted by the
// importer: {"name":"...","contours":[{"points":[[x,y],...]}]}
export const JSON_EXAMPLE = JSON.stringify(
  {
    name: 'custom-diamond',
    contours: [
      { points: [[-15, 0], [0, 15], [15, 0], [0, -15]] },
      { points: [[-4, 0], [0, -4], [4, 0], [0, 4]] },
    ],
  },
  null,
  2
);
