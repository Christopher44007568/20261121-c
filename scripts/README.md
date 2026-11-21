# 数值探针

在项目根目录用 `node scripts/<file>.mjs` 运行。

- `acute-tip-demo.mjs`：锐角尖刺上的尖端削顶对比（MSDF vs 单通道 SDF）。
- `tip-clipping-sweep.mjs`：跨纹理尺寸与放大倍率扫描削顶像素数。
- `boundary-acc.mjs` / `boundary-all.mjs`：解析边界点上的距离场 RMS 误差。
- `e2e.mjs`：跑通全部内置字形的烘焙、差分、热图与 JSON 导入管线。
