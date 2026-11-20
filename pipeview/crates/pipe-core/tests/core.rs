use pipe_core::cull::cull;
use pipe_core::math::Mat4;
use pipe_core::pick::{pick_bruteforce, pick_visible, Ray};
use pipe_core::store::{Batch, InstanceStore, PipeId, PipeSegment, INSTANCE_SIZE};
use pipe_core::Frustum;

fn seg(id: u32, x: f32) -> PipeSegment {
    PipeSegment {
        id: PipeId(id),
        start: [x, 0.0, 0.0],
        end: [x, 0.0, 10.0],
        radius: 0.5,
    }
}

#[test]
fn upsert_insert_then_move_is_local() {
    let mut s = InstanceStore::new(8);
    let (st, _) = {
        s.apply(&Batch { upserts: vec![seg(1, 0.0), seg(2, 5.0)], removes: vec![] });
        s.flush_dirty()
    };
    assert_eq!(st.bytes, 2 * INSTANCE_SIZE);

    // 移动 id=1：只脏 1 个槽位 = 32B。
    s.apply(&Batch { upserts: vec![seg(1, 100.0)], removes: vec![] });
    let (st, ranges) = s.flush_dirty();
    assert_eq!(st.bytes, INSTANCE_SIZE);
    assert_eq!(ranges.len(), 1);
    assert_eq!(s.slot_of(PipeId(1)), Some(0));
}

#[test]
fn remove_swap_keeps_mapping_consistent() {
    let mut s = InstanceStore::new(8);
    s.apply(&Batch {
        upserts: vec![seg(1, 0.0), seg(2, 5.0), seg(3, 9.0)],
        removes: vec![],
    });
    s.flush_dirty();
    s.apply(&Batch { upserts: vec![], removes: vec![PipeId(1)] });
    assert_eq!(s.len(), 2);
    // id=3 被 swap 到槽位 0，映射必须同步。
    assert_eq!(s.slot_of(PipeId(3)), Some(0));
    assert_eq!(s.id_at(0), PipeId(3));
    let (st, _) = s.flush_dirty();
    assert_eq!(st.bytes, INSTANCE_SIZE); // 只重写槽位 0
    for slot in 0..s.len() as u32 {
        assert_eq!(s.slot_of(s.id_at(slot)), Some(slot));
        assert_eq!(s.instances()[slot as usize].pick_id(), s.id_at(slot));
    }
}

#[test]
fn dirty_ranges_merge() {
    let mut s = InstanceStore::new(8);
    let ups: Vec<_> = (1..=10).map(|i| seg(i, i as f32 * 3.0)).collect();
    s.apply(&Batch { upserts: ups, removes: vec![] });
    s.flush_dirty();
    // 移动相邻三段 → 合并为一个区间。
    let ups: Vec<_> = (4..=6).map(|i| seg(i, 50.0)).collect();
    let st = s.apply(&Batch { upserts: ups, removes: vec![] });
    assert_eq!(st.bytes, 3 * INSTANCE_SIZE);
    let (st2, ranges) = s.flush_dirty();
    assert_eq!(ranges.len(), 1);
    assert_eq!(st2.bytes, 3 * INSTANCE_SIZE);
}

#[test]
fn frustum_cull_and_pick_agree() {
    let mut s = InstanceStore::new(8);
    s.apply(&Batch {
        upserts: vec![seg(1, 0.0), seg(2, 1000.0)], // 2 在远处
        removes: vec![],
    });
    let view = Mat4::look_at([0.0, 0.0, -20.0], [0.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
    let proj = Mat4::perspective(60f32.to_radians(), 1.0, 0.1, 100.0);
    let fr = Frustum::from_view_proj(&proj.mul(&view));
    let vis = cull(&s, &fr);
    assert_eq!(vis.len(), 1);
    assert_eq!(s.id_at(vis[0]), PipeId(1));

    // 正对 id=1 的射线：可见集拾取命中 1；暴力拾取也命中 1。
    let ray = Ray { origin: [0.0, 0.0, -20.0], dir: [0.0, 0.0, 1.0] };
    let hv = pick_visible(&s, &vis, &ray).unwrap();
    let hb = pick_bruteforce(&s, &ray).unwrap();
    assert_eq!(hv.id, PipeId(1));
    assert_eq!(hv.id, hb.id);

    // 正对 id=2（视锥外）的射线：可见集拾取必须为 None。
    let ray2 = Ray { origin: [1000.0, 0.0, -20.0], dir: [0.0, 0.0, 1.0] };
    assert!(pick_visible(&s, &vis, &ray2).is_none());
    assert_eq!(pick_bruteforce(&s, &ray2).unwrap().id, PipeId(2));
}

#[test]
fn mass_delete_upload_is_bounded() {
    let mut s = InstanceStore::new(1024);
    let ups: Vec<_> = (1..=1000).map(|i| seg(i, i as f32 * 3.0)).collect();
    s.apply(&Batch { upserts: ups, removes: vec![] });
    s.flush_dirty();
    // 删除后半段 500 根：swap-remove 只会把存活者搬到被删槽位，
    // 上传量 ≤ 500 个槽位，而不是全量 1000。
    let removes: Vec<_> = (501..=1000).map(PipeId).collect();
    s.apply(&Batch { upserts: vec![], removes });
    let (st, _) = s.flush_dirty();
    assert_eq!(s.len(), 500);
    assert!(st.bytes <= 500 * INSTANCE_SIZE, "bytes={}", st.bytes);
}

#[test]
fn mass_delete_dirty_ranges_clamped_to_len() {
    // 回归：批量删除时早期标脏的槽位可能超出最终长度，flush 必须截断。
    let mut s = InstanceStore::new(1024);
    let ups: Vec<_> = (1..=1000).map(|i| seg(i, i as f32 * 3.0)).collect();
    s.apply(&Batch { upserts: ups, removes: vec![] });
    s.flush_dirty();
    // 随机删 600 根（交错命中前后段），最终 len=400。
    let removes: Vec<_> = (1..=1000)
        .filter(|i| i % 5 != 0 && *i <= 750)
        .map(PipeId)
        .collect();
    s.apply(&Batch { upserts: vec![], removes });
    let (_st, ranges) = s.flush_dirty();
    for (off, lo, hi) in ranges {
        assert!(hi < s.len() as u32, "dirty range {lo}..={hi} beyond len {}", s.len());
        assert_eq!(off, lo as u64 * INSTANCE_SIZE);
        let _ = s.slice_bytes(lo, hi); // 不得 panic
    }
}
