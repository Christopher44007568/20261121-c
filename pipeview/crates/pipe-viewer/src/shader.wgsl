struct Uniform {
    vp: mat4x4<f32>,
    eye: vec4<f32>,
    highlight: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
};
@group(0) @binding(0) var<uniform> u: Uniform;

struct VsIn {
    @location(0) pos: vec3<f32>,   // 单位圆柱：半径1，轴向 +Y，y∈[0,1]
    @location(1) nrm: vec3<f32>,
    @location(2) a: vec4<f32>,     // start.xyz, radius
    @location(3) b: vec4<f32>,     // end.xyz, pick_id bits
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world_n: vec3<f32>,
    @location(1) world_p: vec3<f32>,
    @location(2) id: u32,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    let axis = in.b.xyz - in.a.xyz;
    let len = max(length(axis), 1e-6);
    let w = axis / len;
    var helper = vec3<f32>(0.0, 1.0, 0.0);
    if abs(w.y) > 0.99 {
        helper = vec3<f32>(1.0, 0.0, 0.0);
    }
    let uu = normalize(cross(helper, w));
    let vv = cross(w, uu);
    let radius = in.a.w;
    let world = in.a.xyz + (uu * in.pos.x + vv * in.pos.z) * radius + w * in.pos.y * len;
    let world_n = normalize(uu * in.nrm.x + vv * in.nrm.z + w * in.nrm.y);

    var out: VsOut;
    out.clip = u.vp * vec4<f32>(world, 1.0);
    out.world_n = world_n;
    out.world_p = world;
    out.id = bitcast<u32>(in.b.w);
    return out;
}

fn id_color(id: u32) -> vec3<f32> {
    let h = id * 2654435761u;
    let r = f32((h >> 0u) & 255u) / 255.0;
    let g = f32((h >> 8u) & 255u) / 255.0;
    let b = f32((h >> 16u) & 255u) / 255.0;
    return 0.35 + 0.5 * vec3<f32>(r, g, b);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    var base = id_color(in.id);
    if in.id == u.highlight {
        base = vec3<f32>(1.0, 0.25, 0.1);
    }
    let n = normalize(in.world_n);
    let l = normalize(vec3<f32>(0.5, 0.8, 0.3));
    let diff = max(dot(n, l), 0.0);
    let v = normalize(u.eye.xyz - in.world_p);
    let spec = pow(max(dot(reflect(-l, n), v), 0.0), 24.0) * 0.25;
    let col = base * (0.25 + 0.75 * diff) + vec3<f32>(spec);
    return vec4<f32>(col, 1.0);
}
