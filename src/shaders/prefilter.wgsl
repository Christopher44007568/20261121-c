// Soft-knee luminance threshold (Frostbite-style quadratic knee).
// Pixels below `threshold - knee` contribute nothing; values around the
// threshold roll on smoothly instead of hard-clipping, so a dim filament
// never pops in/out as its brightness crosses the cutoff.

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

fn softThreshold(c : vec3f) -> vec3f {
  let brightness = max(max(c.r, c.g), c.b);
  let knee = max(p.knee, 1e-4);
  // Standard Frostbite quadratic soft-knee:
  //   soft = clamp(brightness - threshold + knee, 0, 2*knee)^2 / (4*knee)
  //   contribution = max(soft, brightness - threshold)
  // Below threshold-knee nothing passes; the quadratic ramps through the
  // threshold band, then the hard linear term takes over above it.
  var soft = brightness - p.threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / max(4.0 * knee, 1e-4);
  let contribution = max(soft, brightness - p.threshold);
  let scale = contribution / max(brightness, 1e-4);
  return c * clamp(scale, 0.0, 1.0);
}

@fragment
fn fs_prefilter(in : VertOut) -> @location(0) vec4f {
  let c = textureLoad(srcTex, vec2i(in.pos.xy), 0);
  return vec4f(softThreshold(c.rgb), 1.0);
}
