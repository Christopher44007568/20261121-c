//! 拾取：射线-胶囊求交。只在裁剪可见集上拾取，
//! 保证“被裁掉的永远拾取不到”，渲染与拾取天然一致。
use crate::math::{add, dot, scale, sub, Vec3};
use crate::store::{InstanceStore, PipeId};

#[derive(Clone, Copy, Debug)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3, // 归一化
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PickHit {
    pub id: PipeId,
    pub slot: u32,
    pub t: f32, // 沿射线的距离
}

/// 射线与线段最近点参数（射线 t，线段 s∈[0,1]）。
/// 返回 None 表示平行退化。
fn ray_segment_closest(ray: &Ray, a: Vec3, b: Vec3) -> Option<(f32, f32)> {
    let seg = sub(b, a);
    let r = sub(ray.origin, a);
    let aa = dot(ray.dir, ray.dir); // =1
    let bb = dot(ray.dir, seg);
    let cc = dot(seg, seg);
    let dd = dot(ray.dir, r);
    let ee = dot(seg, r);
    let denom = aa * cc - bb * bb;
    let s = if denom.abs() < 1e-9 {
        // 射线与线段平行：取线段端点中较近者
        if ee > 0.0 { 1.0 } else { 0.0 }
    } else {
        ((aa * ee - bb * dd) / denom).clamp(0.0, 1.0)
    };
    let mut t = (bb * s - dd) / aa;
    if t < 0.0 {
        // 最近点在射线起点后方：重新以 t=0 求 s
        t = 0.0;
        let s0 = if cc < 1e-12 { 0.0 } else { (-ee / cc).clamp(0.0, 1.0) };
        return Some((t, s0));
    }
    Some((t, s))
}

/// 单根射线对可见槽位集合拾取，返回最近命中。
pub fn pick_visible(store: &InstanceStore, visible: &[u32], ray: &Ray) -> Option<PickHit> {
    let mut best: Option<PickHit> = None;
    for &slot in visible {
        let inst = &store.instances()[slot as usize];
        let (a, b, radius) = (inst.start(), inst.end(), inst.radius());
        let Some((t, s)) = ray_segment_closest(ray, a, b) else {
            continue;
        };
        let p_ray = add(ray.origin, scale(ray.dir, t));
        let p_seg = add(a, scale(sub(b, a), s));
        let dist2 = dot(sub(p_ray, p_seg), sub(p_ray, p_seg));
        if dist2 <= radius * radius {
            let hit_t = t - (radius * radius - dist2).sqrt().max(0.0);
            let better = match best {
                Some(h) => hit_t < h.t,
                None => true,
            };
            if better {
                best = Some(PickHit {
                    id: inst.pick_id(),
                    slot,
                    t: hit_t,
                });
            }
        }
    }
    best
}

/// 由相机参数构造穿过归一化设备坐标 (ndc_x, ndc_y ∈ [-1,1]) 的世界射线。
pub fn ray_from_camera(
    eye: Vec3,
    forward: Vec3,
    right: Vec3,
    up: Vec3,
    tan_half_fov: f32,
    aspect: f32,
    ndc_x: f32,
    ndc_y: f32,
) -> Ray {
    let dir = crate::math::normalize(add(
        add(forward, scale(right, ndc_x * tan_half_fov * aspect)),
        scale(up, ndc_y * tan_half_fov),
    ));
    Ray { origin: eye, dir }
}

// 供测试/基准使用的暴力对照：全量拾取（不经过裁剪集）。
pub fn pick_bruteforce(store: &InstanceStore, ray: &Ray) -> Option<PickHit> {
    let all: Vec<u32> = (0..store.len() as u32).collect();
    pick_visible(store, &all, ray)
}

