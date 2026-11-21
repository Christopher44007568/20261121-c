# 坐标链与误差口径

## 1. 世界坐标

WGS84 参数：

```text
a  = 6378137 m
f  = 1 / 298.257223563
e² = f(2 - f)
N  = a / sqrt(1 - e² sin²φ)

x = (N + h) cos φ cos λ
y = (N + h) cos φ sin λ
z = (N(1 - e²) + h) sin φ
```

共享基准为 `31.2399°N, 121.4949°E, h=8 m`。地点局部 ENU 轴由该地点的经纬度生成，
标记偏移始终沿地点切平面：

```text
markerEcef = siteEcef
           + east  * offsetEast
           + north * offsetNorth
           + up    * offsetUp
```

这样 50 mm 的标记间距是地面上的物理 50 mm，而不是在 ECEF 三个轴上各加 5 cm 后得到
的倾斜间距。

## 2. 相机与投影

相机在共享 ENU 中定义 `eye`、`target`、`up`。视矩阵行为 `right`、`up`、`-forward`。
给定视空间点 `v`，屏幕位置为：

```text
ndcX = v.x / (tan(fovY/2) * aspect * -v.z)
ndcY = v.y / (tan(fovY/2) * -v.z)
```

`camera.js` 与 `precision.js` 使用同一个公式；后者把中间乘加按 `Math.fround()`
量化为 float32，模拟 GPU 的逐操作舍入。

## 3. RTC

```text
relativeEnu = markerEnu - eyeEnu       // Float64
view         = R * relativeEnu         // Float64
attribute    = f32(view)               // 每次提交只量化一次
```

相机移动时，标记之间的差值仍在双精度中计算，因此远近标记不会因为绝对坐标 ULP
不同而跳动。

## 4. HI/LO

```text
hi = f32(ecef)
lo = f32(ecef - hi)
relative = f32((markerHi - cameraHi) + (markerLo - cameraLo))
view     = f32(Rf32 * relative)
```

`hi` 在 4.6e6 m 附近的 ULP 约为 0.5 m，但两个相近的 `hi` 相减是精确的；剩余
0.5 m 量级的 `lo` 再以约 3e-8 m 的 float32 ULP 补回。若先把 `hi + lo` 还原为
绝对 float32，0.5 m 量化误差会重新出现，这就是 `absoluteF32` 反例基线。

## 5. 拾取

可见 pass 与颜色 ID pass：

1. 共用 `resolveView()`。
2. 共用同一组相机 uniform（`uRot`、`uCamHi`、`uCamLo`）。
3. 共用同一份标记中心数据和 billboard 尺寸。

颜色 pass 每个标记输出 `(id/255, 0, 0, 1)`。读取时只取一个像素，映射回标记。
CPU 射线路径用 Float64 相机投影参考中心，与颜色结果对照。

“近景无遮挡样本”指参考中心与其它所有可见标记中心的屏幕距离都大于一个 billboard
直径。巡航中会出现较低相机高度导致的投影重叠，此时颜色 pass 返回最前面的标记是
正确行为，不应算作坐标误差。

## 6. 误差采样

`scripts/generate-error-report.js` 以 0.18 s 间隔走完整条 33.2 s 巡航，覆盖：

- 总览环绕；
- 外滩下降与近景环绕；
- 两地点之间的切向转移；
- 陆家嘴近景环绕与返回。

每个可见标记记录：

- Float64 参考屏幕坐标；
- RTC 屏幕坐标；
- HI/LO 屏幕坐标；
- 直接绝对 ECEF float32 屏幕坐标；
- 标记两两投影间距与 Float64 参考间距之差。

像素误差按 CSS 像素统计。直方图区间为
`1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 1+` 像素。
