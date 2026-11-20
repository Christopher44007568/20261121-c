//! 三个回放场景：全量加载、少量变动、大批删除。
use pipe_core::store::{Batch, InstanceStore, PipeId, PipeSegment, UploadStats};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::fmt::Write as _;
use std::time::Instant;

pub const TOTAL: u32 = 100_000;
pub const SMALL_MOVES: u32 = 200;
pub const MASS_DELETE: u32 = 60_000;

/// 生成确定性的工业管网：沿网格主干 + 分支的管段。
pub fn gen_pipes(n: u32) -> Vec<PipeSegment> {
    let mut rng = StdRng::seed_from_u64(42);
    let mut out = Vec::with_capacity(n as usize);
    let mut cursor = [0.0f32; 3];
    for i in 0..n {
        // 随机行走的主干，偶尔长距离跨接，模拟管廊。
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

fn fmt_stats(name: &str, stats: &UploadStats, elapsed_ms: f64, out: &mut String) {
    writeln!(
        out,
        "| {name} | {} | {} | {} B ({:.1} KiB) | {elapsed_ms:.2} ms |",
        stats.instances, stats.ranges, stats.bytes, stats.bytes as f64 / 1024.0
    )
    .unwrap();
}

pub struct ReplayResult {
    pub store: InstanceStore,
    pub full: (UploadStats, f64),
    pub small: (UploadStats, f64),
    pub mass: (UploadStats, f64),
}

pub fn replay() -> ReplayResult {
    let pipes = gen_pipes(TOTAL);
    let mut store = InstanceStore::new(TOTAL as usize);

    // 场景 1：全量加载（单批 upsert 10 万段）。
    let t = Instant::now();
    let s_full = store.apply(&Batch {
        upserts: pipes.clone(),
        removes: vec![],
    });
    let (up_full, _) = store.flush_dirty();
    let full = (up_full, t.elapsed().as_secs_f64() * 1e3);
    debug_assert_eq!(s_full.bytes, up_full.bytes);

    // 场景 2：少量变动（200 段移动 = 稳定 ID 的 upsert）。
    let mut rng = StdRng::seed_from_u64(7);
    let moves: Vec<PipeSegment> = (0..SMALL_MOVES)
        .map(|_| {
            let mut seg = pipes[rng.gen_range(0..TOTAL) as usize];
            seg.start[0] += rng.gen_range(-3.0..3.0);
            seg.end[0] += rng.gen_range(-3.0..3.0);
            seg
        })
        .collect();
    let t = Instant::now();
    store.apply(&Batch {
        upserts: moves,
        removes: vec![],
    });
    let (up_small, _) = store.flush_dirty();
    let small = (up_small, t.elapsed().as_secs_f64() * 1e3);

    // 场景 3：大批删除（随机 6 万段）。
    let mut ids: Vec<PipeId> = (1..=TOTAL).map(PipeId).collect();
    for i in (1..ids.len()).rev() {
        let j = rng.gen_range(0..=i);
        ids.swap(i, j);
    }
    let removes: Vec<PipeId> = ids.into_iter().take(MASS_DELETE as usize).collect();
    let t = Instant::now();
    store.apply(&Batch {
        upserts: vec![],
        removes,
    });
    let (up_mass, _) = store.flush_dirty();
    let mass = (up_mass, t.elapsed().as_secs_f64() * 1e3);

    ReplayResult {
        store,
        full,
        small,
        mass,
    }
}

pub fn run_all() -> String {
    let mut out = String::new();
    writeln!(out, "## 回放场景").unwrap();
    writeln!(out, "| 场景 | 实例数 | 脏区间数 | 上传字节 | 耗时 |").unwrap();
    writeln!(out, "|---|---|---|---|---|").unwrap();

    let r = replay();
    fmt_stats("全量加载 100k", &r.full.0, r.full.1, &mut out);
    fmt_stats("少量变动 200 段", &r.small.0, r.small.1, &mut out);
    fmt_stats("大批删除 60k", &r.mass.0, r.mass.1, &mut out);
    writeln!(out).unwrap();

    out.push_str(&crate::verify::consistency_audit(&r.store));
    out
}
