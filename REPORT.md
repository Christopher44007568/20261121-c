# 离线 AO 烘焙器交付报告

## 目标与边界

实现面向前端程序化零件网格的离线 AO 工具。几何由平面、球、圆柱与
盒体基元组合，输出可切换的逐顶点遮蔽或按零件 UV 图集光照贴图。所有
离线参考图、曲线和浏览器视口共享 `src/geometry.js`、`src/scenes.js`、
`src/bvh.js`、`src/ao.js` 与 `src/sampling.js`。

## 采样与自交抑制

- 每个着色点以法线构造正交切线基，使用正常朝向的半球 Hammersley
  序列；样本按顶点和种子旋转，避免固定条带。
- `directionality` 在均匀半球与余弦加权分布间连续插值；可见性始终按
  `max(0, dot(direction, normal))` 加权，保持 AO 积分一致。
- `samples` 只改变射线数，`maxDistance` 只改变射线上限，界面和 API
  中不绑定档位。
- 抑制开启时：法线偏置、`tMin`、源零件跳过和源面跳过同时生效。三个
  场景的零件均为凸基元，所以源零件再命中可安全视为数值自交；其他
  零件仍产生真实遮挡。
- 抑制关闭用于诊断：低样本下可能把源零件近场自交或采样方差放大为
  相对参考显著变暗的“黑点”。

## 验收场景

| 场景 | 顶点 / 三角形 | 默认最大距离 | 用途 |
| --- | ---: | ---: | --- |
| `sphere-plane` | 2312 / 4256 | 2.4 m | 接触点、球面软梯度 |
| `edge-contact` | 1435 / 2256 | 2.4 m | 平台边缘与悬挑圆柱 |
| `stacked-gap` | 1470 / 2328 | 1.2 m | 三层板，层间 45 mm |

## 参考与收敛

- 参考：512 SPP，逐场景生成 `reference`、仅 AO 和诊断标记三张 900×650
  PNG。
- 收敛：4、8、16、32、64、128、256、512 SPP；每档使用种子 1、2、3
  重复，统计相对 512 SPP 参考的 RMSE、MAE、最大误差和黑点错配数。
- 距离扫描：0.2、0.4、0.7、1.2、2.4、4.8 m，记录平均 AO、暗点比例
  与遮挡比例。
- 图表输出为 `artifacts/convergence.svg` 与
  `artifacts/distance-sweep.svg`；原始数据在 `artifacts/data/`。

## 异常黑点定位

诊断固定为 4 SPP、关闭自交抑制，并与 512 SPP 参考比较。若参考 AO
大于 0.15，而压力值低于 `max(0.02, referenceAO × 0.55)`，则记录：

- 全局顶点索引、零件名与局部顶点；
- 三维位置与法线；
- 压力 AO、参考 AO、邻点平均 AO；
- 超出量排序，供 UI 列表和参考图红圈使用。

`artifacts/data/diagnostics.json` 保存完整定位数据，
`reference/<case>-diagnostics.png` 用空间去重后的红圈标出主要异常。

## 复现

```bash
npm test
npm run generate
npm run verify
```

`npm test` 覆盖网格朝向、BVH 距离边界、源零件抑制、采样确定性、
参数独立性、光照贴图覆盖、收敛与诊断。`npm run verify` 校验数据与
PNG/SVG 产物，并启动隔离端口与无头 Chromium 完成一次真实 Worker
烘焙、场景切换和光照贴图切换。
