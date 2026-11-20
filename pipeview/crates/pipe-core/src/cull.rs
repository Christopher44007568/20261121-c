//! 视锥裁剪：Gribb-Hartmann 平面提取 + 管线段保守测试。
use crate::math::{Mat4, Vec3};
use crate::store::InstanceStore;

#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub n: Vec3, // 已归一化，指向视锥内侧
    pub d: f32,
}

impl Plane {
    #[inline]
    pub fn distance(&self, p: Vec3) -> f32 {
        self.n[0] * p[0] + self.n[1] * p[1] + self.n[2] * p[2] + self.d
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Frustum {
    pub planes: [Plane; 6],
}

impl Frustum {
    /// 从 view_proj 矩阵提取 6 个裁剪平面（列主序）。
    pub fn from_view_proj(m: &Mat4) -> Self {
        let c = &m.0;
        let row = |i: usize| [c[0][i], c[1][i], c[2][i], c[3][i]];
        let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
        let combo = |a: [f32; 4], b: [f32; 4], s: f32| {
            [
                a[0] + s * b[0],
                a[1] + s * b[1],
                a[2] + s * b[2],
                a[3] + s * b[3],
            ]
        };
        let mk = |v: [f32; 4]| {
            let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            Plane {
                n: [v[0] / l, v[1] / l, v[2] / l],
                d: v[3] / l,
            }
        };
        Frustum {
            planes: [
                mk(combo(r3, r0, 1.0)),  // left
                mk(combo(r3, r0, -1.0)), // right
                mk(combo(r3, r1, 1.0)),  // bottom
                mk(combo(r3, r1, -1.0)), // top
                mk(combo(r3, r2, 1.0)),  // near
                mk(combo(r3, r2, -1.0)), // far
            ],
        }
    }

    /// 管线段（胶囊）与视锥的保守相交测试：
    /// 仅当两端点在同一平面外侧（含半径余量）时才剔除。
    #[inline]
    pub fn segment_visible(&self, a: Vec3, b: Vec3, radius: f32) -> bool {
        for p in &self.planes {
            if p.distance(a) < -radius && p.distance(b) < -radius {
                return false;
            }
        }
        true
    }
}

/// 对全部实例做视锥裁剪，返回可见槽位下标（升序，与拾取共享同一集合）。
pub fn cull(store: &InstanceStore, frustum: &Frustum) -> Vec<u32> {
    let mut visible = Vec::with_capacity(store.len() / 2 + 64);
    for (i, inst) in store.instances().iter().enumerate() {
        if frustum.segment_visible(inst.start(), inst.end(), inst.radius()) {
            visible.push(i as u32);
        }
    }
    visible
}
