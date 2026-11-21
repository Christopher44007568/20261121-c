# Procedural Road Toolkit (Godot 4.2)

从中心曲线与横断面生成带超高（superelevation）和宽度变化的双车道三维网格，
支持沿弯道保持纹理世界尺度，并提供无重叠面的 T 字支线衔接。

## 目录结构

- `road_generator/road_curve.gd` — 三次贝塞尔曲线链，弧长参数化、曲率、反向
- `road_generator/road_profile.gd` — 宽度关键帧、超高关键帧、7 列双车道横断面
- `road_generator/road_mesh_builder.gd` — 顶面 + 侧壁网格，UV.v = 弧长桩号
- `road_generator/road_t_junction.gd` — `RoadTJunction3D`，T 字路口组件
- `demo/road_network_demo.gd` — 演示网络的数据与实例化
- `demo/road_demo.gd` / `road_demo.tscn` — 编辑器示例（`@tool` 可重建）
- `analysis/geometry_analyzer.gd` — 30 项几何核对，输出 JSON 报告

## 生成流程

1. `RoadCurve` 以锚点 + 入/出手柄构建贝塞尔段，内部按弧长重采样。
2. `RoadProfile` 在每个桩号插值半幅宽度与横坡，绕中心线旋转得到超高。
3. `RoadMeshBuilder` 沿曲线采样断面行，绕序按实际切线方向自适应，
   保证顶面法线恒为 `+Y`、侧壁法线恒朝外。
4. 纹理坐标 `UV.v` 直接写入弧长桩号，弯道处纹理不拉伸。

## T 字路口无重叠的保证

- 主路网格在路口桩号插入额外采样行。
- 支线路口首行直接复用主路左边缘的 7 个顶点，接缝误差为 0。
- 支线在过渡长度内由主路半幅宽度扩展到自身全宽，所有顶点投影到
   最近主路断面后均位于主路路幅之外（分析器逐点验证）。

## 运行几何分析

```bash
godot --headless -- --analyze
```

报告写入 `artifacts/geometry_analysis.json`，包含每项检查的通过状态、
数值细节，以及网格规模、曲率安全裕度和路口覆盖度指标。
