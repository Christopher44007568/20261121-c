# DX12 屏幕空间反射（SSR）设计说明

## 1. 目标与范围

为 DX12 小场景（一面贴地镜 + 3 个球体 + 2 个立方体 + 程序化天空）加入屏幕空间反射，满足：

- 使用**深度层级（Hi-Z）**加速射线步进。
- 使用**厚度阈值**剔除薄壁/背面/轮廓假命中。
- 提供**稳定的环境回退**：确定性的程序化天空，任何帧都不依赖历史缓存。
- 反射物**出屏或被遮挡时不残留上一帧图像**：历史缓存有硬性作废规则。
- 准备**两条相机路径**（orbit / dolly），分别覆盖环绕出屏与低位推移出屏。
- 输出**命中置信度**与「有效屏幕命中 → 环境回退」的**像素级曲线**。
- 用**几何参考真值**（CPU 光线/平面/球体/盒体求交）评估交点正确性。

仓库同时包含：

- `shaders/` + `src/`：真实 DX12/HLSL 实现（需 Windows + Windows SDK 构建）。
- `reference/`：与 HLSL 同算法的 C++17 CPU 参考实现，可在无 GPU 环境构建并产出全部验证工件。

## 2. 目录结构

```
src/            DX12 宿主：设备、交换链、G-buffer、Hi-Z、SSR、TAA、合成
shaders/        HLSL：GBuffer / HiZ / SSRResolve / Temporal / Composite / Sky
reference/      CPU 参考实现（与 HLSL 一一对应）+ 无残影单元测试
tools/          纯标准库 CSV 汇总脚本
artifacts_data/ 运行参考实现生成的 PNG / CSV 工件
docs/           本设计文档
```

## 3. 渲染管线

```
G-Buffer ──► 线性深度 Hi-Z 金字塔 ──► SSR 射线步进 ──► 时间累积(含作废) ──► 合成
 (MRT)         (保守最大深度)          (厚度+置信度)      (历史/天空)        (镜面混合)
```

### 3.1 G-Buffer（`shaders/GBuffer.hlsl`）

多渲染目标输出：线性视图深度、视图法线、世界法线、世界坐标、反照率、材质标志
（bit0 标记贴地镜）。视图空间采用 D3D 约定：相机朝 **+Z**，NDC z∈[0,1]。

### 3.2 Hi-Z 金字塔（`shaders/HiZ.hlsl`）

- 每级存储 2×2 footprint 的**保守最大线性视图深度**。
- 空像素为 `+inf`；只有当 4 个子像素全空时，父级才保持 `+inf`。
- 关键决策：**使用线性深度而非 NDC 深度**。NDC 深度在远处被压缩
  （例如 8~20 世界单位仅占 0.008 的 NDC 带宽），会让深度比较失效。

### 3.3 SSR 射线步进（`shaders/SSR.hlsli` 与 `reference/ssr_trace.hpp`）

- 反射方向在**世界空间**计算（视图射线关于世界法线反射），再变换到视图空间，
  与几何真值使用完全相同的反射方向。
- 屏幕空间使用全分辨率 **DDA** 逐格步进。
- **Hi-Z 仅用于跳过可证明为空的 footprint**（最大深度为 `+inf`）。任何含几何的
  单元格都在全分辨率判定，避免粗 footprint 混合「物体 + 远处地面」导致最大深度
  被污染而漏检真实交点。
- **厚度阈值**：命中要求射线视图深度落在表面深度的
  `[-frontEps, thicknessWorld]` 带内。前向 epsilon 吸收 DDA 量化，后向界剔除
  越过薄表面过远的假命中。
- 贴地镜射线**永不与地面自身求交**，只接受反射物体。
- 步进原因码：`1 hit / 2 offscreen / 3 maxdist / 4 steps / 5 backface / 6 occluded`。

### 3.4 命中置信度

`confidence = edgeFade × facing × (0.55 + 0.45·thicknessMargin) × distanceFade`

- `edgeFade`：靠近屏幕边缘平滑降权，让出屏过渡自然。
- `facing`：背面法线降权。
- `thicknessMargin`：厚度余量越小越不可靠。
- `distanceFade`：长射线更可能遗漏屏幕外数据。

### 3.5 时间累积与历史作废（`shaders/Temporal.hlsl`）

历史样本只有同时满足以下条件才复用：

1. **当前像素仍有有效屏幕命中（硬性规则）**——这是无残影的核心；
2. 重投影点在屏幕内且仍落在贴地镜；
3. 重投影线性深度差 < `TAA_DEPTH_REJ`（0.25 世界单位）；
4. 历史自身置信度 > 0。

任一条件失败（反射物出屏、被遮挡、达到最大距离、步数耗尽）都直接采用当前样本；
当前样本在无命中时就是确定性天空回退，因此**单帧内**即可清除旧图像。

## 4. 稳定环境回退

`SampleSky` 是纯函数：垂直渐变 + 软太阳瓣，方向固定、无随机抖动、无历史依赖。
回退路径在任何帧都可计算，保证 SSR 缺失数据时画面稳定且可复现。

## 5. 两条相机路径（`src/CameraPaths.h` / `reference/ssr_camera.hpp`）

- **orbit（环绕）**：绕场景弧形运动，中段红色球从左侧出屏，触发其倒影的历史作废。
- **dolly（低位推移）**：贴近地面横移，末段绿色球与黄色盒被推出屏幕/落到屏幕边缘，
  产生持续的命中→回退过渡。

两条路径共用同一组关键帧表，C++ 参考与 DX12 demo 行为一致。

## 6. 验证与工件

参考实现输出到 `artifacts_data/`：

- `*_beauty.png`：最终合成（含镜面反射，黄色方块为追踪锚点）。
- `*_confidence.png`：置信度热力图 + 追踪像素的射线路径（白色）与命中点（青色）。
- `*_fallback_mask.png`：绿色=屏幕命中，红色=环境回退。
- `*_geo_overlay.png`：与几何真值对比——绿色一致、红色漏检、黄色假命中、蓝色正确回退。
- `hit_stats.csv`：逐帧地面像素、SSR 命中、几何命中、可见性、一致性、平均置信度、
  历史作废事件数。
- `transition_curves.csv`：多个世界空间锚点逐帧的命中/回退状态、置信度、命中 UV 与原因码。

无残影单元测试 `reference/test_no_stale.cpp`：构造反射物在屏（帧 A）与完全出屏
（帧 B）的两台相机，断言帧 B 所有丢失命中的地面像素颜色与天空回退的误差 < 0.02。

## 7. 构建与运行

### CPU 参考（任意平台，仅需 g++/clang++）

```
cmake -B build && cmake --build build
./build/ssr_ref 320 180 10
./build/test_no_stale
python3 tools/summarize.py
```

### DX12 demo（Windows + Visual Studio 2022 + Windows SDK）

```
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

运行时通过 `D3DCompileFromFile` 编译 `shaders/`，需把该目录放在工作目录下。
交互：`Space` 切换相机路径，`D` 切换调试叠加，`Esc` 退出。

## 8. 已知屏幕空间固有局限

- 屏幕外或被遮挡的反射物无法命中，只能走天空回退（见 geo_overlay 的红/蓝区域）。
- G-buffer 仅存正面，镜面看到的物体底面/背面会降低可用命中率。
- 这些局限由置信度与历史作废规则显式管理，而非产生错误或残留图像。
