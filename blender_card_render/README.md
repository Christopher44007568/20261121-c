# Blender 批渲染零件卡片

从坐标系、尺寸、原点各不相同的零件批量生成统一风格的多视角零件卡片。
相机取景完全由**实际几何包围体**驱动，与零件原点无关；正交相机保证
真实长宽比；所有零件和视角共用同一套世界空间照明环境。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `frame_math.py` | 纯 Python 取景数学（视角基向量、包围体拟合、像素留白），可脱离 Blender 单测 |
| `coord_systems.py` | 坐标系归一化（up-axis、自定义轴映射）与 alpha 留白测量 |
| `render_cards.py` | Blender 内运行的主批渲染脚本 |
| `make_examples.py` | 生成细长杆、飞离天线、Y-up 支架/销钉等示例零件 |
| `examples/job_config.json` | 示例作业配置 |
| `tests/test_frame_math.py` | 取景数学单元测试（9 个用例） |

## 使用方式

```bash
# 1. 生成示例零件（STL/GLB）
blender --background --python blender_card_render/make_examples.py

# 2. 按作业配置批渲染
blender --background --python blender_card_render/render_cards.py \
    -- --config blender_card_render/examples/job_config.json

# 3. 不依赖 Blender 的数学单测
python3 -m unittest tests.test_frame_math -v
```

本机无系统级 Blender 时可用仓库根目录的 `run_blender.sh` 包装器（自动注入
`work/local-libs` 下的 `libSM`/`libICE` 依赖）。

## 作业配置

```json
{
  "engine": "BLENDER_EEVEE",
  "resolution": [1024, 1024],
  "margin_fraction": 0.08,
  "transparent_film": true,
  "measure_alpha_margins": true,
  "uniform_material": true,
  "output_dir": "../output",
  "views": ["front", "right", "top", "iso"],
  "parts": [
    {
      "id": "flying_antenna",
      "file": "geometry/flying_antenna.stl",
      "up_axis": "Z_UP",
      "axis_map": ["+X", "-Z", "+Y"],
      "unit_scale": 1.0,
      "origin_offset": [0.0, 0.0, 0.0]
    }
  ]
}
```

- `views`：内置 `front/back/left/right/top/bottom/iso`，也可在
  `custom_views` 中用 `direction` + `up` 自定义视角。
- `up_axis`：`Z_UP`/`Y_UP`/`X_UP`，按导入器约定旋转；`axis_map` 用
  `+X/-X/+Y/-Y/+Z/-Z` 显式声明源坐标系三个轴（STL/OBJ 等无约定格式）。
  glTF 导入器强制 Y-up→Z-up，因此 GLB 不允许再给 `axis_map`（会重复转换）。
- `unit_scale` / `origin_offset`：处理不同单位和原点平移；取景只看世界空间
  包围体，原点在几何外也不影响构图。
- 支持格式：`.blend/.stl/.ply/.obj/.gltf/.glb/.fbx`。

## 取景与留白

1. 对每个零件采集所有网格顶点的世界坐标，计算真实 AABB（与原点无关）。
2. 对每个视角把 AABB 八个角点投影到相机平面，取投影包围盒。
3. 按 `margin_fraction`（每边留白占比）和输出宽高比求帧尺寸；同一零件所有
   视角共享最大的 `ortho_scale`，因此各视角 `pixels_per_unit` 完全一致，
   真实长宽比不被拉伸。
4. 相机目标点取 AABB 中心，近远裁剪面按投影深度加 padding，细长件与飞离
   中心的附件都不会被裁切。

清单 `output/render_manifest.json` 对每个视角同时给出两套留白：

- `pixel_margin_geometric`：由包围体投影预测的四边像素留白（保守、对称）；
- `pixel_margin_measured`：渲染后重读 PNG 的 alpha 通道，按真实剪影测得的
  四边像素留白和剪影像素尺寸；正交视角两者误差 ≤1px。

## 统一照明

照明在零件循环之前构建一次且不随相机动：节点化世界环境（渐变天空，可通过
`hdri` 替换为 HDRI）+ 固定世界坐标的 key/fill/rim 三盏面光。配合可选的
`uniform_material`，保证所有卡片风格一致。
