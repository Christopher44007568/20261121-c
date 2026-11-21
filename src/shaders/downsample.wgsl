// Half-resolution downsampling, two flavours:
//
// naive    : a single nearest/load at the 2x-lattice source center.
//            A subpixel filament that never lands on a lattice texel is
//            dropped outright, producing 0 -> peak -> 0 frame swings.
//
// improved : energy-conserving 2x2 area box. Each output texel averages the
//            source block it covers, so a subpixel feature keeps its total
//            energy no matter where it lands; edge taps are clamped.

struct FilterParams {
  texelSize : vec2f,
  threshold : f32,
  knee      : f32,
  strength  : f32,
  exposure  : f32,
  _p2       : vec2f,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> p : FilterParams;

struct VertOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi : u32) -> VertOut {
  var tri = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0),
  );
  let xy = tri[vi];
  var out : VertOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = xy * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}

fn dims() -> vec2i {
  return vec2i(textureDimensions(srcTex));
}

fn load(c : vec2i) -> vec3f {
  let d = dims();
  let q = clamp(c, vec2i(0), d - vec2i(1));
  return textureLoad(srcTex, q, 0).rgb;
}

@fragment
fn fs_naive(in : VertOut) -> @location(0) vec4f {
  let d = dims();
  let uv = in.uv;
  let center = vec2i(uv * vec2f(d)) - vec2i(0);
  let c = clamp(center, vec2i(0), d - vec2i(1));
  return vec4f(textureLoad(srcTex, c, 0).rgb, 1.0);
}

@fragment
fn fs_improved(in : VertOut) -> @location(0) vec4f {
  let d = dims();
  let center = vec2i(in.uv * vec2f(d));

  // 2x2 source block around the half-resolution lattice point.
  let c  = load(center);
  let r  = load(center + vec2i(1, 0));
  let b  = load(center + vec2i(0, 1));
  let br = load(center + vec2i(1, 1));

  // Area average: the four weights sum to 1, so the block's total energy is
  // carried into the output texel independent of subpixel phase.
  let box = (c + r + b + br) * 0.25;
  return vec4f(box, 1.0);
}
