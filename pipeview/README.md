# 工业管网实例化渲染（wgpu）

10 万段管道的实例化渲染视图，后端批量移动/删除时只上传局部脏区间，
视锥裁剪与拾取共享同一可见集，保证"裁掉的永远拾取不到"。

## 结构

- `crates/pipe-core` — 数据层（无 GPU 依赖，可单测）
  - `store.rs`：稳定 `PipeId` → 槽位映射的稠密实例数组；upsert/删除（swap-remove）
    只标脏受影响槽位，`flush_dirty()` 产出合并后的脏区间（字节偏移 + 槽位范围），
    直接对应 `queue.write_buffer` 调用。实例布局 32B：`(start.xyz, radius)` + `(end.xyz, pick_id)`。
  - `cull.rs`：Gribb-Hartmann 视锥平面提取 + 管线段（胶囊）保守剔除。
  - `pick.rs`：射线-胶囊求交，**只在裁剪可见集上拾取**，与渲染天然一致。
- `crates/pipe-viewer` — wgpu + winit 实时视图
  - 12 面单位圆柱网格 × 10 万实例一次 draw call；每帧 CPU 裁剪后流式上传可见子集。
  - 左键拖拽旋转 / 滚轮缩放 / 点击拾取（命中管道红色高亮，日志输出稳定 ID）。
  - 每 150 帧模拟一批后端推送（移动 100 / 删除 50 / 新增 50），日志打印上传字节。
- `crates/pipe-bench` — 更新回放基准
  - 场景：全量加载 100k / 少量变动 200 段 / 大批删除 60k。
  - 校验：ID↔槽位映射自洽、2000 条随机射线"可见集拾取 vs 全量暴力拾取"一致性、
    命中 ID 与缓冲内嵌 pick_id 一致。
  - `--gpu`：真实创建 wgpu device，按脏区间 `write_buffer` 后回读整缓冲逐字节比对，
    并核对回读缓冲中的 pick_id。

## 运行

```bash
cargo test -p pipe-core          # 数据层单元测试
cargo run --release -p pipe-bench          # CPU 回放 + 一致性审计
cargo run --release -p pipe-bench -- --gpu # 追加 GPU 上传回读审计
cargo run --release -p pipe-viewer         # 交互视图（需显示环境）
```

报告输出：`artifacts/replay_report.md`（本仓库已附一次实测结果）。

## 实测（llvmpipe, release）

| 场景 | 实例数 | 脏区间 | 上传字节 | 耗时 |
|---|---|---|---|---|
| 全量加载 100k | 100000 | 1 | 3 200 000 B | ~10 ms |
| 少量变动 200 段 | 100000 | 199 | 6 400 B | ~0.1 ms |
| 大批删除 60k | 40000 | ~11.8k | ~765 KB | ~30 ms |

少量变动的上传量仅为全量的 0.2%；大批删除因 swap-remove 搬运存活者，
上传量以被删槽位数为上界（远小于全量重写）。GPU 回读与 CPU 镜像逐字节一致。
