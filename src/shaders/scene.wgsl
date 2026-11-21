// Scene generator: a uniform 18% gray card plus a vertically spanning,
// 1-px-wide HDR "glowing filament" whose horizontal position is subpixel.
// Coverage is computed analytically so a line placed between two pixel
// columns splits its energy across them (no hard point-sample hit/miss).

struct SceneParams {
  resolution : vec2f,
  lineX      : f32,
  lineWidth  : f32,
  lineEnergy : f32,
  grayTarget : f32,
  tint       : vec3f,
  _pad       : f32,
}

@group(0) @binding(0) var<uniform> p : SceneParams;

struct VertOut {
  @builtin(position) pos : vec4f,
  @location(0) frag      : vec2f,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi : u32) -> VertOut {
  var out : VertOut;
  var tri = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0),
  );
  let xy = tri[vi];
  out.pos = vec4f(xy, 0.0, 1.0);
  // Pixel-center coordinate of the framebuffer (0.5 .. resolution-0.5).
  out.frag = vec2f((xy * vec2f(0.5, -0.5) + vec2f(0.5)) * p.resolution);
  return out;
}

// Analytic coverage of a width-`lineWidth` rectangle centered on lineX
// over the 1px-wide column whose center is pixelX.
fn lineCoverage(pixelX : f32) -> f32 {
  let left  = p.lineX - p.lineWidth * 0.5;
  let right = p.lineX + p.lineWidth * 0.5;
  let a = clamp(right - pixelX, 0.0, 1.0);
  let b = clamp(left  - pixelX, 0.0, 1.0);
  return a - b;
}

@fragment
fn fs_scene(in : VertOut) -> @location(0) vec4f {
  let coverage = lineCoverage(in.frag.x);
  let rgb = vec3f(p.grayTarget) + p.tint * (coverage * p.lineEnergy);
  return vec4f(rgb, 1.0);
}
