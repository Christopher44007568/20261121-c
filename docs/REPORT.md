# 屏幕空间次表面散射演示报告

本仓库包含两部分：

1. `UnitySSSDemo/`：可直接用 Unity 2022.3 LTS + HDRP 14 打开的工程源码，
   包含自定义材质、ID/厚度缓冲、96-tap 扩散 Custom Pass、程序化场景与
   边缘测量脚本。
2. `tools/`：与 HLSL 常量逐项对齐的离线参考模型（Python），在无 Unity
   编辑器的环境中复现着色器数学，输出测量数据与全部对比图件到
   `artifacts/generated/`。

## 扩散轮廓

三瓣可分离高斯轮廓，每瓣带独立 RGB 标准差与权重；采样前乘以可分离核
标定系数 `1 / sqrt(1 + 2/3) ≈ 0.7869`（Jimenez/HDRP 惯例）。红色通道
一阶有效半径

`r_eff,R = Σ_k w_k σ_k · 0.7869 = 3.157 mm`

厚度通过 Beer-Lambert 项 `T = exp(-thickness / mfp)` 衰减散射能量，
平均自由程 R/G/B = 3.5 / 1.7 / 0.9 mm。

## 材质 ID 防火墙

ID/厚度 Pass 把量化材质 ID 写入 R 通道。扩散 Pass 的每个 tap 都执行
`gate = (sampleID == centreID) ? 1 : 0`，不匹配的 tap 权重为零并对剩余
权重重新归一化。验证脚本 `tools/validate_diffusion.py` 证明：

- ID 3 与 ID 4 零间隙相邻时，门控开启的暗侧能量变化为 `0.0e+00`；
- 关闭门控时同位置出现约 0.49 的跨材质串色。

40 mm 背板的红色透射率约 `1.1e-5`，对扩散 Pass 完全不透明；0.45 mm
耳廓薄部保持 0.88 的透射率，因此红色晕染集中在耳轮与耳垂。

## 硬光边尺度规律

测量定义：暗侧 10%–90% 距离的一半

`r_px = (x10 − x90) / 2`

相机换算：`pixels_per_m = H / (2 d tan(FovY/2))`，720p、30° FOV、
1× 下相机距离 336 mm。

| 模式 | 像素半径 | 世界半径 |
| --- | --- | --- |
| 轮廓随尺度缩放 (profile × s) | 恒定 13.02 px | 3.256 × s mm，线性增长 |
| 轮廓固定 1× (常见错误) | 随 1/s 缩小 | 恒定 3.256 mm |

结论：正确实现把世界单位轮廓半径逐像素换算回像素，几何、相机距离与
轮廓半径同时乘 s 时屏幕足迹不变；若忘记换算（profile-fixed 对照），
世界半径看似恒定但像素足迹随尺度收缩，是屏幕空间 SSS 的典型错误模式。

## 产物

`artifacts/generated/`：

- `measurements.csv` / `measurements.json`：8 个尺度 × 2 模式的测量；
- `edge_cross_sections.png`：截面曲线 A/B 与像素/世界半径规律 C/D；
- `edge_scale_views.png`：×0.5/×1/×2/×4 的 SSS 开/关视图；
- `sss_on_off_comparison.png`、`hero_sss_enabled/disabled.png`：耳廓场景；
- `material_id_and_thickness.png`：Beauty / ID / 厚度三联缓冲；
- `id_gate_seam.png`：零间隙接缝的门控开关直接对比；
- `preview_toggle.gif`：开关循环。

离线图件是着色器数学的解析/离散参考渲染，用于在无 GPU 环境中验证规律；
Unity 工程内的 `SSSEdgeMeasurement` 通过 ScreenCapture 走相同的测量路径，
在编辑器中运行即可产出同构 CSV。
