// Half-resolution upsampling with additive blur (Unreal dual-filter bloom):
//
// naive    : nearest load of the matching low-res texel + add to target.
// improved : 9-tap tent (3x3, weights 1/2/1 on each axis, /16).
//
// srcTex  : the coarser, already-accumulated upsample mip (filtered here).
// addTex  : this level's downsampled prefiltered mip, added back so each
//           frequency band contributes once (energy-preserving chain).
// Target and bound textures are distinct objects, avoiding a read/write
// feedback loop. All accumulation stays linear and pre-exposure.

struct FilterParams {
  texelSize : vec2f,
  threshold : f32,
  knee      : f32,
  strength  : f32,
  exposure  : f32,
  _p2       : vec2f,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var addTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> p : FilterParams;

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

fn srcDims() -> vec2i {
  return vec2i(textureDimensions(srcTex));
}

fn loadSrc(c : vec2i) -> vec3f {
  let d = srcDims();
  let q = clamp(c, vec2i(0), d - vec2i(1));
  return textureLoad(srcTex, q, 0).rgb;
}

@fragment
fn fs_naive(in : VertOut) -> @location(0) vec4f {
  let d = srcDims();
  let c = clamp(vec2i(in.uv * vec2f(d)), vec2i(0), d - vec2i(1));
  let up = textureLoad(srcTex, c, 0).rgb;
  let prev = textureLoad(addTex, vec2i(in.pos.xy), 0).rgb;
  return vec4f(prev + up, 1.0);
}

@fragment
fn fs_improved(in : VertOut) -> @location(0) vec4f {
  let d = srcDims();
  let center = vec2i(in.uv * vec2f(d));

  let c  = loadSrc(center);
  let t  = loadSrc(center + vec2i( 0, -1));
  let b  = loadSrc(center + vec2i( 0,  1));
  let l  = loadSrc(center + vec2i(-1,  0));
  let r  = loadSrc(center + vec2i( 1,  0));
  let tl = loadSrc(center + vec2i(-1, -1));
  let tr = loadSrc(center + vec2i( 1, -1));
  let bl = loadSrc(center + vec2i(-1,  1));
  let br = loadSrc(center + vec2i( 1,  1));

  // 3x3 tent: [1 2 1] outer, [2 4 2] cross, center 4 — sum 16.
  let sum = c * 4.0
          + (t + b + l + r) * 2.0
          + tl + tr + bl + br;
  let up = sum * (1.0 / 16.0);
  let prev = textureLoad(addTex, vec2i(in.pos.xy), 0).rgb;
  return vec4f(prev + up, 1.0);
}
