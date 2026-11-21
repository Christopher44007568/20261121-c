// HDR composite: sceneHDR + bloomHDR * strength, stored rgba16float.
// No exposure is applied here — exposure belongs to the final display pass,
// after all HDR accumulation is finished.

struct FilterParams {
  texelSize : vec2f,
  threshold : f32,
  knee      : f32,
  strength  : f32,
  exposure  : f32,
  _p2       : vec2f,
}

@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var bloomTex : texture_2d<f32>;
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

@fragment
fn fs_composite(in : VertOut) -> @location(0) vec4f {
  let px = vec2i(in.pos.xy);
  let scene = textureLoad(sceneTex, px, 0).rgb;
  let bloom = textureLoad(bloomTex, px, 0).rgb;
  return vec4f(scene + bloom * p.strength, 1.0);
}
