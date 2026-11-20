//! 模拟后端：初始管网生成 + 周期性批量更新（移动/删除/新增）。
use pipe_core::store::{Batch, InstanceStore, PipeId, PipeSegment};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

pub fn gen_pipes(n: u32) -> Vec<PipeSegment> {
    let mut rng = StdRng::seed_from_u64(42);
    let mut out = Vec::with_capacity(n as usize);
    let mut cursor = [0.0f32; 3];
    for i in 0..n {
        let step = if rng.gen_bool(0.05) {
            [
                rng.gen_range(-40.0..40.0),
                rng.gen_range(-2.0..8.0),
                rng.gen_range(-40.0..40.0),
            ]
        } else {
            [
                rng.gen_range(-6.0..6.0),
                rng.gen_range(-0.5..1.5),
                rng.gen_range(-6.0..6.0),
            ]
        };
        let end = [
            cursor[0] + step[0],
            (cursor[1] + step[1]).clamp(0.0, 30.0),
            cursor[2] + step[2],
        ];
        out.push(PipeSegment {
            id: PipeId(i + 1),
            start: cursor,
            end,
            radius: rng.gen_range(0.15..0.9),
        });
        cursor = end;
    }
    out
}

pub fn random_batch(store: &InstanceStore, tick: u64) -> Batch {
    let mut rng = StdRng::seed_from_u64(tick);
    let len = store.len() as u32;
    if len < 100 {
        return Batch::default();
    }
    let mut batch = Batch::default();
    // 移动 100 段（稳定 ID 的 upsert）
    for _ in 0..100 {
        let slot = rng.gen_range(0..len);
        let id = store.id_at(slot);
        let inst = store.instances()[slot as usize];
        batch.upserts.push(PipeSegment {
            id,
            start: [
                inst.start()[0] + rng.gen_range(-2.0..2.0),
                inst.start()[1],
                inst.start()[2] + rng.gen_range(-2.0..2.0),
            ],
            end: [
                inst.end()[0] + rng.gen_range(-2.0..2.0),
                inst.end()[1],
                inst.end()[2] + rng.gen_range(-2.0..2.0),
            ],
            radius: inst.radius(),
        });
    }
    // 删除 50 段
    for _ in 0..50 {
        batch.removes.push(store.id_at(rng.gen_range(0..len)));
    }
    // 新增 50 段（新 ID 段：tick 派生，避免冲突）
    let base = 10_000_000u32 + (tick as u32) * 1000;
    for i in 0..50 {
        let x = rng.gen_range(-150.0..150.0);
        let z = rng.gen_range(-150.0..150.0);
        batch.upserts.push(PipeSegment {
            id: PipeId(base + i),
            start: [x, rng.gen_range(0.0..20.0), z],
            end: [x + rng.gen_range(-8.0..8.0), rng.gen_range(0.0..20.0), z + rng.gen_range(-8.0..8.0)],
            radius: rng.gen_range(0.15..0.9),
        });
    }
    batch
}
