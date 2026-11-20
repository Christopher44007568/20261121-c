//! 一致性校验：裁剪/拾取 ID 一致 + 可选 GPU 上传审计（回读比对）。
use pipe_core::cull::cull;
use pipe_core::math::{Mat4, Vec3};
use pipe_core::pick::{pick_bruteforce, pick_visible, ray_from_camera};
use pipe_core::store::{InstanceStore, PipeId, INSTANCE_SIZE};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::collections::HashSet;
use std::fmt::Write as _;

pub fn camera() -> (Vec3, Vec3, Vec3, Vec3, f32, f32, Mat4) {
    let eye = [180.0, 140.0, 180.0];
    let center = [0.0, 10.0, 0.0];
    let up = [0.0, 1.0, 0.0];
    let fwd = pipe_core::math::normalize(pipe_core::math::sub(center, eye));
    let right = pipe_core::math::normalize(pipe_core::math::cross(fwd, up));
    let up2 = pipe_core::math::cross(right, fwd);
    let fov = 60f32.to_radians();
    let aspect = 16.0 / 9.0;
    let view = Mat4::look_at(eye, center, up);
    let proj = Mat4::perspective(fov, aspect, 1.0, 2000.0);
    (eye, fwd, right, up2, (fov * 0.5).tan(), aspect, proj.mul(&view))
}

/// 裁剪可见集与拾取结果的一致性审计。
pub fn consistency_audit(store: &InstanceStore) -> String {
    let mut out = String::new();
    writeln!(out, "## 拾取一致性审计").unwrap();

    // 1) ID 映射自洽：slot→id→slot 往返一致。
    let mut map_ok = true;
    for slot in 0..store.len() as u32 {
        let id = store.id_at(slot);
        if store.slot_of(id) != Some(slot)
            || store.instances()[slot as usize].pick_id() != id
        {
            map_ok = false;
            break;
        }
    }
    writeln!(out, "- ID↔槽位映射自洽: {}", ok(map_ok)).unwrap();

    // 2) 视锥裁剪。
    let (eye, fwd, right, up, tan_h, aspect, vp) = camera();
    let frustum = pipe_core::Frustum::from_view_proj(&vp);
    let visible = cull(store, &frustum);
    let vset: HashSet<u32> = visible.iter().copied().collect();
    writeln!(
        out,
        "- 视锥内可见: {} / {} 段",
        visible.len(),
        store.len()
    )
    .unwrap();

    // 3) 随机射线：可见集拾取 vs 全量暴力拾取。
    let mut rng = StdRng::seed_from_u64(99);
    let rays = 2000;
    let mut hits = 0;
    let mut consistent = 0;
    let mut mismatches = 0;
    for _ in 0..rays {
        let nx = rng.gen_range(-1.0..1.0);
        let ny = rng.gen_range(-1.0..1.0);
        let ray = ray_from_camera(eye, fwd, right, up, tan_h, aspect, nx, ny);
        let vis_hit = pick_visible(store, &visible, &ray);
        let bf_hit = pick_bruteforce(store, &ray);
        let ok = match (vis_hit, bf_hit) {
            (Some(v), Some(b)) => {
                if vset.contains(&b.slot) {
                    // 暴力最近命中在视锥内 ⇒ 两者必须是同一根管。
                    v.id == b.id && v.slot == b.slot
                } else {
                    // 暴力最近命中被裁掉 ⇒ 可见命中必须更远。
                    v.t >= b.t - 1e-3
                }
            }
            (None, Some(b)) => !vset.contains(&b.slot), // 视锥内无命中 ⇒ 暴力命中必在视锥外
            (None, None) => true,
            (Some(_), None) => false, // 不可能：可见集是全集的子集
        };
        if vis_hit.is_some() {
            hits += 1;
        }
        if ok {
            consistent += 1;
        } else {
            mismatches += 1;
        }
    }
    writeln!(
        out,
        "- 随机射线 {rays} 条: 命中 {hits}, 一致 {consistent}, 不一致 {mismatches}"
    )
    .unwrap();
    writeln!(out, "- 拾取 ID 一致性: {}", ok(mismatches == 0)).unwrap();

    // 4) 命中 ID 与实例缓冲内嵌 pick_id 一致。
    let mut id_ok = true;
    for _ in 0..200 {
        let nx = rng.gen_range(-1.0..1.0);
        let ny = rng.gen_range(-1.0..1.0);
        let ray = ray_from_camera(eye, fwd, right, up, tan_h, aspect, nx, ny);
        if let Some(h) = pick_visible(store, &visible, &ray) {
            let inst = &store.instances()[h.slot as usize];
            if inst.pick_id() != h.id || store.id_at(h.slot) != h.id {
                id_ok = false;
                break;
            }
        }
    }
    writeln!(out, "- 命中ID == 缓冲内嵌pick_id: {}", ok(id_ok)).unwrap();
    out
}

fn ok(b: bool) -> &'static str {
    if b {
        "✅"
    } else {
        "❌"
    }
}

/// GPU 审计：真实创建 device，按脏区间 write_buffer，再回读整缓冲逐字节比对，
/// 并核对回读缓冲中的 pick_id 与 CPU 端稳定 ID 完全一致。
pub async fn gpu_upload_audit(_report: &str) -> Result<String, String> {
    use crate::scenario::{gen_pipes, MASS_DELETE, SMALL_MOVES, TOTAL};
    use pipe_core::store::Batch;
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};

    let instance = wgpu::Instance::default();
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
        .map_err(|e| format!("无可用适配器: {e:?}"))?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
        .map_err(|e| format!("创建设备失败: {e:?}"))?;

    let mut out = String::from("\n## GPU 上传审计\n");
    writeln!(out, "- 适配器: {:?}", adapter.get_info().name).unwrap();

    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("instances"),
        size: TOTAL as u64 * INSTANCE_SIZE,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: TOTAL as u64 * INSTANCE_SIZE,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    // 重新回放三个场景，把 flush_dirty 的区间真正写入 GPU。
    let pipes = gen_pipes(TOTAL);
    let mut store = InstanceStore::new(TOTAL as usize);
    let mut uploaded = 0u64;
    let mut flush = |store: &mut InstanceStore, queue: &wgpu::Queue| {
        let (stats, ranges) = store.flush_dirty();
        for (offset, lo, hi) in ranges {
            queue.write_buffer(&buf, offset, store.slice_bytes(lo, hi));
        }
        uploaded += stats.bytes;
        stats
    };

    let s1 = flush_apply(&mut store, Batch { upserts: pipes.clone(), removes: vec![] }, &mut flush, &queue);
    let mut rng = StdRng::seed_from_u64(7);
    let moves: Vec<_> = (0..SMALL_MOVES)
        .map(|_| {
            let mut seg = pipes[rng.gen_range(0..TOTAL) as usize];
            seg.start[0] += rng.gen_range(-3.0..3.0);
            seg.end[0] += rng.gen_range(-3.0..3.0);
            seg
        })
        .collect();
    let s2 = flush_apply(&mut store, Batch { upserts: moves, removes: vec![] }, &mut flush, &queue);
    let mut ids: Vec<PipeId> = (1..=TOTAL).map(PipeId).collect();
    for i in (1..ids.len()).rev() {
        let j = rng.gen_range(0..=i);
        ids.swap(i, j);
    }
    let removes: Vec<PipeId> = ids.into_iter().take(MASS_DELETE as usize).collect();
    let s3 = flush_apply(&mut store, Batch { upserts: vec![], removes }, &mut flush, &queue);

    writeln!(
        out,
        "- GPU 实际上传: 全量 {} B / 变动 {} B / 删除 {} B（合计 {} B）",
        s1.bytes, s2.bytes, s3.bytes, uploaded
    )
    .unwrap();

    // 回读并逐字节比对（只比对 0..len*32 的有效区）。
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_buffer_to_buffer(&buf, 0, &staging, 0, staging.size());
    queue.submit([encoder.finish()]);
    let slice = staging.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::PollType::wait()).unwrap();
    let data = slice.get_mapped_range();
    let expect = bytemuck_cast(store.instances());
    let valid = expect.len();
    let bytes_ok = data[..valid] == expect[..];
    writeln!(out, "- 回读有效区逐字节一致: {}", ok(bytes_ok)).unwrap();

    // 回读缓冲中的 pick_id 与稳定 ID 对照。
    let mut id_ok = true;
    if bytes_ok {
        for slot in 0..store.len() as u32 {
            let off = slot as usize * INSTANCE_SIZE as usize;
            let bits = u32::from_le_bytes(data[off + 28..off + 32].try_into().unwrap());
            if PipeId(bits) != store.id_at(slot) {
                id_ok = false;
                break;
            }
        }
    }
    writeln!(out, "- 回读 pick_id 与稳定ID一致: {}", ok(id_ok)).unwrap();
    drop(data);
    staging.unmap();
    Ok(out)
}

fn flush_apply(
    store: &mut InstanceStore,
    batch: pipe_core::store::Batch,
    flush: &mut impl FnMut(&mut InstanceStore, &wgpu::Queue) -> pipe_core::store::UploadStats,
    queue: &wgpu::Queue,
) -> pipe_core::store::UploadStats {
    store.apply(&batch);
    flush(store, queue)
}

fn bytemuck_cast(s: &[pipe_core::store::GpuInstance]) -> &[u8] {
    bytemuck::cast_slice(s)
}
