// Droplet SDF sphere tracing: two droplets + ground plane.
// Modes: polynomial smin (non-conservative) vs log-sum-exp smin (conservative).

struct Params {
  resolution : vec2f,
  time       : f32,
  sep        : f32,   // half separation of droplet centers
  blendK     : f32,   // smin radius (neck thickness)
  sminMode   : u32,   // 0 = polynomial, 1 = log-sum-exp
  viewMode   : u32,   // 0 = shaded, 1 = step heatmap, 2 = normals
  shadowOn   : u32,
  camPos     : vec3f,
  _pad0      : f32,
  camRight   : vec3f,
  _pad1      : f32,
  camUp      : vec3f,
  _pad2      : f32,
  camFwd     : vec3f,
  focal      : f32,
  stepMode   : u32,   // 0 = standard, 1 = over-relaxed, 2 = over-relaxed + guard
  omega      : f32,   // relaxation factor in (1,2)
};
@group(0) @binding(0) var<uniform> P : Params;

const MAX_STEPS : u32 = 160u;
const T_MAX     : f32 = 12.0;
const EPS       : f32 = 1e-4;

fn sdSphere(p : vec3f, c : vec3f, r : f32) -> f32 {
  return length(p - c) - r;
}

// iq polynomial smooth-min. Fast but NOT a distance bound:
// near the blend region it can exceed min(a,b), so sphere tracing
// may overshoot the thin neck and miss the surface.
fn sminPoly(a : f32, b : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// log-sum-exp smooth-min: always <= min(a,b), and its gradient norm
// is <= 1 when a,b are exact distances, so it is a conservative
// (never overshooting) field for sphere tracing.
fn sminLSE(a : f32, b : f32, k : f32) -> f32 {
  let m = min(a, b);
  return m - k * log(1.0 + exp((m - max(a, b)) / k));
}

fn smin(a : f32, b : f32, k : f32) -> f32 {
  if (P.sminMode == 0u) { return sminPoly(a, b, k); }
  return sminLSE(a, b, k);
}

fn mapDroplets(p : vec3f) -> f32 {
  let a = sdSphere(p, vec3f(-P.sep, 0.0, 0.0), 0.60);
  let b = sdSphere(p, vec3f( P.sep, 0.0, 0.0), 0.45);
  return smin(a, b, P.blendK);
}

fn map(p : vec3f) -> f32 {
  let drops = mapDroplets(p);
  let ground = p.y + 0.85;
  return min(drops, ground); // exact min keeps ground conservative
}

struct Hit {
  t      : f32,
  steps  : u32,
  hit    : bool,
  missed : bool, // stepped past a sign change (non-conservative overshoot)
};

fn sphereTrace(ro : vec3f, rd : vec3f) -> Hit {
  var h : Hit;
  h.t = 0.0; h.steps = 0u; h.hit = false; h.missed = false;
  var prevD = 1e10;
  var prevT = 0.0;
  var prevStep = 0.0;
  var i = 0u;
  loop {
    if (i >= MAX_STEPS) { break; }
    i = i + 1u;
    h.steps = i;
    let p = ro + rd * h.t;
    let d = map(p);
    // Keinert-style overshoot test (checked BEFORE accepting a hit, so a
    // sample that landed inside the surface still triggers the guard):
    // did the previous relaxed step jump across the surface?
    if (P.stepMode >= 1u && prevStep > 0.0 && d + prevD < prevStep) {
      if (P.stepMode == 2u) {
        // guarded: revert to a standard-size step from the previous point
        h.t = h.t - prevStep + prevD;
        prevStep = prevD;
        continue;
      }
      h.missed = true; // unguarded: accept the (possibly fatal) jump
    }
    // sign change between successive samples => we stepped over a root
    if (d < 0.0 && prevD > 0.0) { h.missed = true; }
    if (d < EPS * max(h.t, 1.0)) {
      h.hit = true;
      // linear refinement between previous and current sample
      let w = prevD / (prevD - d);
      h.t = mix(prevT, h.t, clamp(w, 0.0, 1.0));
      h.steps = i;
      return h;
    }
    if (P.stepMode >= 1u) {
      let s = P.omega * d;
      prevD = d; prevT = h.t; prevStep = s;
      h.t = h.t + s;
    } else {
      prevD = d; prevT = h.t; prevStep = d;
      h.t = h.t + d;
    }
    if (h.t > T_MAX) { return h; }
  }
  h.steps = i;
  return h;
}

fn calcNormal(p : vec3f) -> vec3f {
  let e = vec2f(1e-3, -1e-3);
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

// iq-style soft shadow with a minimum step clamp so grazing
// shadow rays do not stall on the neck silhouette.
fn softShadow(ro : vec3f, rd : vec3f, k : f32) -> f32 {
  var res = 1.0;
  var t = 0.02;
  for (var i = 0u; i < 64u; i = i + 1u) {
    let d = map(ro + rd * t);
    res = min(res, k * d / t);
    t = t + clamp(d, 0.01, 0.25);
    if (res < 0.002 || t > 6.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

fn heatColor(x : f32) -> vec3f {
  // blue -> cyan -> green -> yellow -> red
  let c = clamp(x, 0.0, 1.0) * 4.0;
  let r = clamp(c - 2.0, 0.0, 1.0);
  let g = clamp(c - 1.0, 0.0, 1.0) - clamp(c - 3.0, 0.0, 1.0);
  let b = clamp(1.0 - c, 0.0, 1.0) + clamp(c - 3.0, 0.0, 1.0) * 0.2;
  return vec3f(r, g, b);
}

const LIGHT_DIR : vec3f = vec3f(0.57735, 0.57735, -0.57735);

fn shade(ro : vec3f, rd : vec3f) -> vec3f {
  let h = sphereTrace(ro, rd);

  if (P.viewMode == 1u) {
    return heatColor(f32(h.steps) / f32(MAX_STEPS));
  }
  if (!h.hit) {
    let sky = 0.5 + 0.5 * rd.y;
    return mix(vec3f(0.12, 0.14, 0.20), vec3f(0.45, 0.60, 0.80), sky);
  }
  let p = ro + rd * h.t;
  let n = calcNormal(p);
  if (P.viewMode == 2u) { return n * 0.5 + 0.5; }

  var dif = max(dot(n, LIGHT_DIR), 0.0);
  if (P.shadowOn == 1u && dif > 0.0) {
    dif = dif * softShadow(p + n * 2e-3, LIGHT_DIR, 10.0);
  }
  let skyAmb = 0.5 + 0.5 * n.y;
  let isGround = step(mapDroplets(p), p.y + 0.85 + 1e-3);
  let albedo = mix(vec3f(0.85, 0.45, 0.25), vec3f(0.55, 0.58, 0.62), isGround);
  var col = albedo * (0.25 * skyAmb + 0.9 * dif);
  let spec = pow(max(dot(reflect(-LIGHT_DIR, n), -rd), 0.0), 32.0);
  col = col + vec3f(0.4) * spec * dif;
  // flag non-conservative overshoots in magenta
  if (h.missed) { col = mix(col, vec3f(1.0, 0.0, 1.0), 0.6); }
  return col;
}

@vertex
fn vsMain(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(xy, 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(position) fc : vec4f) -> @location(0) vec4f {
  let uv = (2.0 * fc.xy - P.resolution) / P.resolution.y;
  let ro = P.camPos;
  let rd = normalize(P.camFwd * P.focal + uv.x * P.camRight + uv.y * P.camUp);
  let col = shade(ro, rd);
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}
