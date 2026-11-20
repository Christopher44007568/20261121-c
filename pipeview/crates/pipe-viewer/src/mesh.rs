//! 单位圆柱网格（侧面，radius=1，轴向 +Y，y∈[0,1]）。
pub fn cylinder(segments: u32) -> (Vec<[f32; 6]>, Vec<u32>) {
    let mut verts = Vec::with_capacity((segments * 2) as usize);
    let mut indices = Vec::with_capacity((segments * 6) as usize);
    for i in 0..segments {
        let a = i as f32 / segments as f32 * std::f32::consts::TAU;
        let (s, c) = a.sin_cos();
        verts.push([c, 0.0, s, c, 0.0, s]);
        verts.push([c, 1.0, s, c, 0.0, s]);
    }
    for i in 0..segments {
        let j = (i + 1) % segments;
        let (a, b, c, d) = (i * 2, i * 2 + 1, j * 2, j * 2 + 1);
        indices.extend_from_slice(&[a, c, b, b, c, d]);
    }
    (verts, indices)
}
