struct PreviewUniforms {
    viewport: vec4<f32>,
    camera: vec4<f32>,
}

struct WindowUniforms {
    viewport: vec4<f32>,
    frame: vec4<f32>,
}

@group(0) @binding(0) var<uniform> preview: PreviewUniforms;
@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var<uniform> window_uniforms: WindowUniforms;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn fullscreen_vertex(@builtin(vertex_index) index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0),
    );
    var out: VertexOut;
    out.position = vec4<f32>(positions[index], 0.0, 1.0);
    out.uv = uvs[index];
    return out;
}

fn hash12(p: vec2<f32>) -> f32 {
    let p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    let q = p3 + dot(p3, p3.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

fn environment(dir: vec3<f32>) -> vec3<f32> {
    let horizon = smoothstep(-0.12, 0.8, dir.y);
    let upper = mix(vec3<f32>(0.035, 0.055, 0.085), vec3<f32>(0.20, 0.31, 0.46), horizon);
    let glow = pow(max(dot(dir, normalize(vec3<f32>(-0.55, 0.34, -0.76))), 0.0), 20.0);
    return upper + vec3<f32>(0.95, 0.58, 0.25) * glow * 0.32;
}

fn material(index: f32) -> vec4<f32> {
    if (index < 0.5) {
        return vec4<f32>(0.035, 0.22, 0.58, 0.08);
    }
    if (index < 1.5) {
        return vec4<f32>(0.16, 0.56, 0.43, 0.72);
    }
    return vec4<f32>(0.72, 0.61, 0.45, 0.82);
}

fn aces(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn shade_surface(
    position: vec3<f32>,
    normal: vec3<f32>,
    view_dir: vec3<f32>,
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
) -> vec3<f32> {
    let key_dir = normalize(vec3<f32>(-0.55, 0.78, 0.30));
    let fill_dir = normalize(vec3<f32>(0.72, 0.22, -0.48));
    let rim_dir = normalize(vec3<f32>(0.15, -0.35, 0.92));
    let key_color = vec3<f32>(1.0, 0.78, 0.52) * 5.2;
    let fill_color = vec3<f32>(0.25, 0.48, 1.0) * 2.2;
    let rim_color = vec3<f32>(0.95, 0.35, 0.18) * 3.4;

    let n = normalize(normal);
    let v = normalize(-view_dir);
    let nv = max(dot(n, v), 0.001);
    let dielectric = vec3<f32>(0.04);
    let f0 = mix(dielectric, albedo, metallic);
    let diffuse = albedo * (1.0 - metallic);
    let shininess = mix(150.0, 12.0, roughness);

    var result = diffuse * 0.045 + environment(n) * mix(0.12, 0.55, metallic) * albedo;

    let lights = array<vec3<f32>, 3>(key_dir, fill_dir, rim_dir);
    let colors = array<vec3<f32>, 3>(key_color, fill_color, rim_color);
    for (var i = 0; i < 3; i = i + 1) {
        let l = normalize(lights[i]);
        let h = normalize(l + v);
        let ndl = max(dot(n, l), 0.0);
        let ndh = max(dot(n, h), 0.0);
        let spec = pow(ndh, shininess) * (shininess + 8.0) * 0.025;
        let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
        result += colors[i] * ndl * (diffuse * 0.28 + fresnel * spec);
    }

    let rim = pow(1.0 - nv, 3.0) * (0.20 + metallic * 0.55);
    result += vec3<f32>(0.28, 0.48, 0.82) * rim;
    return aces(result);
}

fn checker_floor(position: vec3<f32>) -> f32 {
    let cell = floor(position.xz * 1.15);
    let checker = abs(cell.x + cell.y) - 2.0 * floor((abs(cell.x + cell.y) + 1.0) * 0.5);
    return mix(0.035, 0.075, checker);
}

@fragment
fn preview_fragment(input: VertexOut) -> @location(0) vec4<f32> {
    let resolution = max(preview.viewport.xy, vec2<f32>(1.0));
    let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
    let p = uv * 2.0 - vec2<f32>(1.0);
    let aspect = resolution.x / resolution.y;

    let yaw = preview.camera.x;
    let pitch = preview.camera.y;
    let distance = preview.camera.z;
    let eye = distance * vec3<f32>(
        cos(pitch) * sin(yaw),
        sin(pitch),
        cos(pitch) * cos(yaw),
    );
    let forward = normalize(-eye);
    let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
    let up = cross(right, forward);
    let ray = normalize(p.x * aspect * right + p.y * up + 1.65 * forward);

    let mat = material(preview.camera.w);
    let sphere_center = vec3<f32>(0.0, 0.06, 0.0);
    let oc = eye - sphere_center;
    let b = dot(oc, ray);
    let c = dot(oc, oc) - 0.90 * 0.90;
    let discriminant = b * b - c;

    var color = environment(ray) * preview.viewport.w;
    var depth = 1.0e9;

    if (discriminant > 0.0) {
        let hit_t = -b - sqrt(discriminant);
        if (hit_t > 0.0) {
            depth = hit_t;
            let hit = eye + ray * hit_t;
            let normal = normalize(hit - sphere_center);
            let patina = 0.84 + 0.16 * sin(hit.y * 18.0 + hit.x * 9.0 + hit.z * 5.0);
            color = shade_surface(hit, normal, ray, mat.rgb * patina, mat.a, 0.30);
        }
    }

    if (ray.y < -0.001) {
        let floor_t = (-0.94 - eye.y) / ray.y;
        if (floor_t > 0.0 && floor_t < depth) {
            let hit = eye + ray * floor_t;
            depth = floor_t;
            let fade = exp(-length(hit.xz) * 0.20);
            let base = vec3<f32>(checker_floor(hit));
            let glow = vec3<f32>(0.08, 0.20, 0.31) * fade;
            color = aces((base + glow) * preview.viewport.w);
        }
    }

    let horizon = pow(1.0 - abs(ray.y), 7.0);
    color += vec3<f32>(0.15, 0.24, 0.38) * horizon * 0.08;
    let vignette = smoothstep(1.45, 0.34, length(p * vec2<f32>(0.78, 1.0)));
    color *= 0.58 + 0.42 * vignette;

    for (var i = 0; i < 3; i = i + 1) {
        let swatch_center = vec2<f32>(-0.88 + f32(i) * 0.115, 0.86);
        let swatch = 1.0 - smoothstep(0.030, 0.036, length((p * vec2<f32>(aspect, 1.0) - swatch_center * vec2<f32>(aspect, 1.0))));
        let swatch_mat = material(f32(i));
        let selected = select(0.45, 1.0, abs(f32(i) - preview.camera.w) < 0.4);
        color = mix(color, swatch_mat.rgb * selected, swatch * 0.92);
    }

    color += (hash12(input.position.xy) - 0.5) * 0.012;
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

@fragment
fn present_fragment(input: VertexOut) -> @location(0) vec4<f32> {
    let resolution = max(window_uniforms.viewport.xy, vec2<f32>(1.0));
    let uv = input.uv;
    let side = min(resolution.x, resolution.y);
    let origin = (resolution - vec2<f32>(side)) * 0.5;
    let pixel = uv * resolution;
    let in_preview = pixel - origin;
    let scene_uv = in_preview / side;
    let inside = all(scene_uv >= vec2<f32>(0.0)) && all(scene_uv <= vec2<f32>(1.0));

    var color = vec3<f32>(0.012, 0.016, 0.024);
    if (inside) {
        let sampled = textureSample(scene_texture, scene_sampler, scene_uv).rgb;
        let edge = min(min(scene_uv.x, 1.0 - scene_uv.x), min(scene_uv.y, 1.0 - scene_uv.y));
        let border = smoothstep(0.0, 0.0035 / (side / resolution.y), edge);
        let frame_color = mix(vec3<f32>(0.16, 0.23, 0.32), vec3<f32>(0.92, 0.56, 0.22), window_uniforms.frame.x);
        color = mix(frame_color * 0.56, sampled, border);
    } else {
        let grid = abs(fract(pixel / 28.0) - 0.5);
        let line = 1.0 - smoothstep(0.47, 0.50, max(grid.x, grid.y));
        color += vec3<f32>(0.025, 0.035, 0.050) * line;
    }

    let vignette = smoothstep(1.20, 0.28, length(uv * 2.0 - 1.0));
    color *= 0.72 + 0.28 * vignette;
    return vec4<f32>(color, 1.0);
}
