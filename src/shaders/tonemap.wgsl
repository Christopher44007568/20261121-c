// Final display pass. Exposure is applied HERE, for the first time,
// followed by a smooth ACES approximation and an sRGB transfer curve.

struct FilterParams {
  texelSize : vec2f,
  threshold : f32,
  knee      : f32,
  strength  : f32,
  exposure  : f32,
  _p2       : vec2f,
}

@group(0) @binding(0) var hdrTex : texture_2d<f32>;
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

fn acesApprox(x : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c : vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(lo, hi, c > vec3f(0.0031308));
}

@fragment
fn fs_tonemap(in : VertOut) -> @location(0) vec4f {
  let hdr = textureLoad(hdrTex, vec2i(in.pos.xy), 0).rgb;
  let exposed = hdr * p.exposure;
  return vec4f(linearToSrgb(acesApprox(exposed)), 1.0);
}
