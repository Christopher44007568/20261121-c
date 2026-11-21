const COMMON = /* wgsl */ `
struct Uniforms {
  resolution : vec2f,
  time : f32,
  dt : f32,
  aspect : f32,
  seed : f32,
  flags : u32,
  viewMode : u32,
  probe : vec2f,
  speedScale : f32,
  pad : f32,
}

@group(0) @binding(0) var<uniform> u : Uniforms;

const PI : f32 = 3.14159265359;
const CORE2 : f32 = 0.0092;
const OBSTACLE_C : vec2f = vec2f(0.34, -0.035);
const OBSTACLE_R : f32 = 0.105;
const GAP_C : vec2f = vec2f(-0.43, -0.265);
const GAP_R : f32 = 0.082;
const GAP_RECT_C : vec2f = vec2f(0.105, 0.305);
const GAP_RECT_H : vec2f = vec2f(0.125, 0.054);

fn hash21(p : vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p : vec2f) -> vec2f {
  var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn noise2(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p : vec2f) -> f32 {
  var q = p;
  var value = 0.0;
  var amplitude = 0.55;
  for (var i = 0; i < 3; i = i + 1) {
    value = value + noise2(q) * amplitude;
    q = q * 2.03 + vec2f(7.1, 13.7);
    amplitude = amplitude * 0.48;
  }
  return value;
}

fn vortexCenter(t : f32) -> vec2f {
  return vec2f(
    -0.1 + 0.118 * sin(0.34 * t),
    0.1 * cos(0.43 * t) + 0.022 * sin(0.73 * t)
  );
}

fn uniformFlow(t : f32) -> vec2f {
  return vec2f(0.64, 0.105 * sin(0.38 * t));
}

fn vortexGamma(t : f32) -> f32 {
  return 0.34 + 0.045 * sin(0.61 * t + 0.35);
}

fn sinkLambda(t : f32) -> f32 {
  return 0.032 + 0.007 * sin(0.47 * t + 1.2);
}

fn sampleVelocity(p : vec2f, t : f32) -> vec2f {
  let center = vortexCenter(t);
  let delta = p - center;
  let denominator = dot(delta, delta) + CORE2;
  let swirl = vortexGamma(t) * vec2f(-delta.y, delta.x) / denominator;
  let sink = -sinkLambda(t) * delta / denominator;
  return uniformFlow(t) + swirl + sink;
}

fn maskAt(p : vec2f) -> u32 {
  let halfWidth = u.aspect * 0.5;
  if (abs(p.x) >= halfWidth || abs(p.y) >= 0.5) {
    return 3u;
  }
  if ((u.flags & 4u) != 0u) {
    if (length(p - GAP_C) < GAP_R) {
      return 2u;
    }
    let gapDelta = abs(p - GAP_RECT_C);
    if (gapDelta.x < GAP_RECT_H.x && gapDelta.y < GAP_RECT_H.y) {
      return 2u;
    }
  }
  if ((u.flags & 2u) != 0u) {
    if (length(p - OBSTACLE_C) < OBSTACLE_R) {
      return 1u;
    }
  }
  return 0u;
}

fn uvToWorld(uv : vec2f) -> vec2f {
  return vec2f((uv.x - 0.5) * u.aspect, 0.5 - uv.y);
}

fn worldToUv(p : vec2f) -> vec2f {
  return vec2f(p.x / u.aspect + 0.5, 0.5 - p.y);
}

fn sdSegment(p : vec2f, a : vec2f, b : vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-7), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sdBox(p : vec2f, halfSize : vec2f) -> f32 {
  let d = abs(p) - halfSize;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdTriangle(p : vec2f, a : vec2f, b : vec2f, c : vec2f) -> f32 {
  let e0 = b - a;
  let e1 = c - b;
  let e2 = a - c;
  let v0 = p - a;
  let v1 = p - b;
  let v2 = p - c;
  let pq0 = v0 - e0 * clamp(dot(v0, e0) / max(dot(e0, e0), 1e-7), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / max(dot(e1, e1), 1e-7), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / max(dot(e2, e2), 1e-7), 0.0, 1.0);
  let s = sign(e0.x * e2.y - e0.y * e2.x);
  let d = min(
    min(vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
    vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x))
  );
  return -sqrt(d.x) * sign(d.y);
}

fn rotate2(p : vec2f, angle : f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn gridLayer(p : vec2f, spacing : f32) -> f32 {
  let coord = p / spacing;
  let g = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), vec2f(1e-5));
  return 1.0 - smoothstep(0.0, 1.15, min(g.x, g.y));
}
`;

const FULLSCREEN_VERTEX = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}
`;

export const seedShader = /* wgsl */ `
${COMMON}
${FULLSCREEN_VERTEX}

@fragment
fn fragmentMain(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.resolution;
  let p = uvToWorld(uv);
  let mask = maskAt(p);
  if (mask != 0u) {
    return vec4f(0.0);
  }

  let warp = vec2f(
    noise2(p * vec2f(5.3, 7.1) + vec2f(1.3, 9.2)),
    noise2(p * vec2f(6.7, 9.4) - vec2f(4.1, 2.8))
  );
  let broad = fbm(p * vec2f(8.5, 12.0) + warp * 1.25);
  let ridge = 1.0 - abs(broad * 2.0 - 1.0);
  let fine = noise2(p * vec2f(102.0, 138.0) + u.seed);
  let ribbon = smoothstep(0.57, 0.82, ridge * 0.78 + fine * 0.24);
  let cells = floor(p * vec2f(330.0, 230.0));
  let speck = step(0.987, hash21(cells + u.seed * 0.173));
  let density = max(ribbon * 0.52, speck * 0.7);
  return vec4f(density, density * 0.76, density * 0.92, 1.0);
}
`;

export const advectShader = /* wgsl */ `
${COMMON}
${FULLSCREEN_VERTEX}

@group(0) @binding(1) var previousTexture : texture_2d<f32>;
@group(0) @binding(2) var linearSampler : sampler;

fn freshDye(p : vec2f, t : f32) -> f32 {
  let halfWidth = u.aspect * 0.5;
  let cells = floor(p * vec2f(250.0, 180.0));
  let tick = floor(t * 11.0);
  let spark = smoothstep(0.989, 0.999, hash21(cells + tick * vec2f(17.0, 29.0) + u.seed));

  let inlet = smoothstep(halfWidth - 0.065, halfWidth - 0.005, -p.x);
  let bandPhase = 0.5 + 0.5 * sin(p.y * 105.0 + 2.2 * sin(p.y * 9.0 - t * 0.8));
  let dashes = smoothstep(0.76, 0.98, bandPhase);
  let inletInk = inlet * dashes * (0.36 + 0.2 * hash21(vec2f(floor(p.y * 130.0), tick)));

  let broad = fbm(p * vec2f(24.0, 33.0) + vec2f(-t * 0.08, t * 0.03));
  let wisps = smoothstep(0.68, 0.9, broad) * 0.018;
  return max(max(spark * 0.22, inletInk), wisps);
}

@fragment
fn fragmentMain(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.resolution;
  let world = uvToWorld(uv);
  if (maskAt(world) != 0u) {
    return vec4f(0.0);
  }

  let initialVelocity = sampleVelocity(world, u.time);
  let speed = length(initialVelocity);
  let substeps = clamp(i32(ceil(speed * u.dt / 0.012)), 1, 10);
  let step = u.dt / f32(substeps);
  var p = world;

  for (var i : i32 = 0; i < 10; i = i + 1) {
    if (i >= substeps) {
      break;
    }
    let sampleTime = u.time - u.dt * (f32(i) + 0.5) / f32(substeps);
    let first = sampleVelocity(p, sampleTime);
    let midpoint = sampleVelocity(p - first * step * 0.5, sampleTime);
    p = p - midpoint * step;
  }

  let previousUv = worldToUv(p);
  var transported = 0.0;
  if (previousUv.x >= 0.0 && previousUv.x <= 1.0 && previousUv.y >= 0.0 && previousUv.y <= 1.0) {
    transported = textureSampleLevel(previousTexture, linearSampler, previousUv, 0.0).r;
    if (maskAt(uvToWorld(previousUv)) != 0u) {
      transported = 0.0;
    }
  }

  let decay = exp(-0.41 * u.dt);
  let fresh = freshDye(world, u.time);
  let density = clamp(max(transported * decay, fresh), 0.0, 1.0);
  return vec4f(density, transported * decay, fresh, 1.0);
}
`;

export const compositeShader = /* wgsl */ `
${COMMON}
${FULLSCREEN_VERTEX}

@group(0) @binding(1) var dyeTexture : texture_2d<f32>;
@group(0) @binding(2) var dyeSampler : sampler;

fn palette(v : vec2f) -> vec3f {
  let speed = length(v);
  let direction = v / max(speed, 1e-5);
  let east = smoothstep(-0.65, 0.8, direction.x);
  let north = smoothstep(-0.65, 0.8, direction.y);
  var color = mix(vec3f(0.82, 0.28, 0.52), vec3f(0.08, 0.82, 0.7), east);
  color = mix(color, vec3f(0.33, 0.4, 0.98), north * 0.4);
  color = mix(color, vec3f(0.98, 0.48, 0.36), smoothstep(0.95, 1.45, speed) * 0.3);
  return color;
}

fn arrowLayer(p : vec2f) -> f32 {
  let cellSize = vec2f(0.084, 0.082);
  let cell = floor(p / cellSize);
  let center = (cell + 0.5) * cellSize;
  if (maskAt(center) != 0u) {
    return 0.0;
  }

  let velocity = sampleVelocity(center, u.time);
  let speed = length(velocity);
  if (speed < 0.015) {
    return 0.0;
  }
  let direction = velocity / speed;
  let local = vec2f(dot(p - center, direction), dot(p - center, vec2f(-direction.y, direction.x)));
  let arrowLength = 0.016 + 0.014 * smoothstep(0.12, 1.2, speed);
  let root = -arrowLength * 0.48;
  let neck = arrowLength * 0.31;
  let tip = arrowLength * 0.54;
  let shaft = sdSegment(local, vec2f(root, 0.0), vec2f(neck, 0.0)) - 0.00135;
  let head = sdTriangle(
    local,
    vec2f(tip, 0.0),
    vec2f(neck, 0.0082),
    vec2f(neck, -0.0082)
  );
  let glyph = 1.0 - smoothstep(0.0, 0.0011, min(shaft, head));
  let travel = fract(u.time * 0.33 + hash21(cell) * 0.77);
  let comet = 1.0 - smoothstep(0.0032, 0.0055, length(local - vec2f(mix(root, tip, travel), 0.0)));
  let fade = smoothstep(0.05, 0.7, speed);
  return max(glyph * 0.72, comet) * fade;
}

fn probeLayer(p : vec2f) -> f32 {
  let delta = p - u.probe;
  let radius = length(delta);
  let ring = 1.0 - smoothstep(0.0005, 0.0018, abs(radius - 0.0185));
  let tickWindow = step(0.0185, radius) * step(radius, 0.031);
  let tick = max(
    1.0 - smoothstep(0.0005, 0.0014, abs(delta.x)),
    1.0 - smoothstep(0.0005, 0.0014, abs(delta.y))
  );
  let velocity = sampleVelocity(u.probe, u.time);
  let speed = length(velocity);
  let direction = velocity / max(speed, 1e-5);
  let local = vec2f(dot(delta, direction), dot(delta, vec2f(-direction.y, direction.x)));
  let stem = sdSegment(local, vec2f(0.007, 0.0), vec2f(0.048, 0.0));
  let headA = sdSegment(local, vec2f(0.048, 0.0), vec2f(0.038, 0.0065));
  let headB = sdSegment(local, vec2f(0.048, 0.0), vec2f(0.038, -0.0065));
  let vector = 1.0 - smoothstep(0.00035, 0.00115, min(stem, min(headA, headB)));
  return max(ring, max(tick * tickWindow, vector));
}

fn hatchLayer(p : vec2f, frequency : f32, diagonal : f32) -> f32 {
  let q = (p.x * diagonal + p.y) * frequency;
  return smoothstep(0.84, 0.99, abs(fract(q) * 2.0 - 1.0));
}

@fragment
fn fragmentMain(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.resolution;
  let p = uvToWorld(uv);
  let mask = maskAt(p);
  let velocity = sampleVelocity(p, u.time);
  let speed = length(velocity);
  let speedNorm = smoothstep(0.03, 1.35, speed);
  let tone = palette(velocity);
  let dye = textureSampleLevel(dyeTexture, dyeSampler, uv, 0.0).r;
  let dyeSoft = smoothstep(0.008, 0.98, dye);
  let dyeCore = pow(dye, 1.65);

  let fineGrid = gridLayer(p, 0.04) * 0.06;
  let majorGrid = gridLayer(p, 0.2) * 0.1;
  var color = vec3f(0.0045, 0.0105, 0.0155);
  color = color + tone * (0.012 + speedNorm * 0.052);
  color = color + vec3f(0.42, 0.58, 0.56) * (fineGrid + majorGrid);
  color = color + tone * dyeSoft * (0.18 + speedNorm * 0.52);
  color = color + vec3f(0.72, 1.0, 0.94) * dyeCore * 0.3;

  if ((u.flags & 1u) != 0u) {
    let arrow = arrowLayer(p);
    color = color + mix(tone, vec3f(0.86, 1.0, 0.97), 0.35) * arrow * 0.35;
  }

  let probe = probeLayer(p);
  color = color + vec3f(1.0, 0.71, 0.34) * probe * 0.8;

  if (mask == 1u) {
    let distance = length(p - OBSTACLE_C);
    let body = vec3f(0.018, 0.03, 0.038) + vec3f(0.027, 0.039, 0.046) * hatchLayer(p, 74.0, 1.0);
    let rim = 1.0 - smoothstep(0.0007, 0.0022, abs(distance - OBSTACLE_R));
    let inner = 1.0 - smoothstep(0.0005, 0.0014, abs(distance - OBSTACLE_R * 0.83));
    let drop = exp(-max(distance - OBSTACLE_R, 0.0) * 95.0) * 0.2;
    color = body + tone * drop + vec3f(0.95, 0.68, 0.32) * (rim * 0.62 + inner * 0.12);
  } else if (mask == 2u) {
    let circleDistance = abs(length(p - GAP_C) - GAP_R);
    let rectDistance = abs(sdBox(p - GAP_RECT_C, GAP_RECT_H));
    let borderDistance = min(circleDistance, rectDistance);
    let angle = atan2(p.y - GAP_C.y, p.x - GAP_C.x);
    let circleDash = step(0.0, sin(angle * 21.0 + u.time * 0.8));
    let rectDash = step(0.0, sin((p.x + p.y) * 145.0));
    let dash = mix(rectDash, circleDash, step(circleDistance, rectDistance));
    let border = (1.0 - smoothstep(0.0005, 0.0018, borderDistance)) * dash;
    let cross = hatchLayer(p, 102.0, 1.0) * 0.55 + hatchLayer(p, 76.0, -1.0) * 0.45;
    color = vec3f(0.031, 0.021, 0.042) + vec3f(0.17, 0.075, 0.22) * cross;
    color = color + vec3f(0.73, 0.35, 0.95) * border * 0.72;
  }

  let halfWidth = u.aspect * 0.5;
  let leftEdge = 1.0 - smoothstep(0.0, 0.0045, p.x + halfWidth);
  let rightEdge = 1.0 - smoothstep(0.0, 0.0045, halfWidth - p.x);
  color = color + vec3f(0.15, 0.8, 0.7) * leftEdge * 0.22;
  color = color + vec3f(0.95, 0.55, 0.32) * rightEdge * 0.2;

  let vignette = 1.0 - 0.3 * dot(uv - 0.5, uv - 0.5);
  let dither = (hash21(position.xy) - 0.5) / 255.0;
  color = max(color * vignette + dither, vec3f(0.0));
  color = pow(color, vec3f(0.91));
  return vec4f(color, 1.0);
}
`;

export const auditShader = /* wgsl */ `
${COMMON}
${FULLSCREEN_VERTEX}

@group(0) @binding(1) var coarseTexture : texture_2d<f32>;
@group(0) @binding(2) var auditSampler : sampler;
@group(0) @binding(3) var fineTexture : texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.resolution;
  let panel = clamp(i32(floor(uv.x * 3.0)), 0, 2);
  let localUv = vec2f(clamp(fract(uv.x * 3.0), 0.002, 0.998), uv.y);
  let coarse = textureSampleLevel(coarseTexture, auditSampler, localUv, 0.0).r;
  let fine = textureSampleLevel(fineTexture, auditSampler, localUv, 0.0).r;
  let difference = clamp(abs(coarse - fine) * 3.8, 0.0, 1.0);

  var color = vec3f(0.006, 0.012, 0.016);
  if (panel == 0) {
    color = color + vec3f(0.07, 0.78, 0.7) * pow(coarse, 0.8) * 1.1;
    color = color + vec3f(0.04, 0.18, 0.17) * coarse;
  } else if (panel == 1) {
    color = color + vec3f(0.93, 0.57, 0.29) * pow(fine, 0.8) * 1.1;
    color = color + vec3f(0.17, 0.09, 0.05) * fine;
  } else {
    color = color + vec3f(0.78, 0.28, 0.96) * difference;
    color = color + vec3f(0.15, 0.04, 0.2) * smoothstep(0.02, 1.0, difference);
  }

  let grid = gridLayer(localUv * vec2f(u.aspect, 1.0) * 24.0, 1.0);
  color = color + vec3f(0.2, 0.3, 0.3) * grid * 0.035;
  let seam = max(
    1.0 - smoothstep(0.0, 0.0015, abs(uv.x - 1.0 / 3.0)),
    1.0 - smoothstep(0.0, 0.0015, abs(uv.x - 2.0 / 3.0))
  );
  color = mix(color, vec3f(0.38, 0.62, 0.59), seam * 0.45);
  let edge = max(
    max(1.0 - smoothstep(0.0, 0.002, uv.x), 1.0 - smoothstep(0.0, 0.002, 1.0 - uv.x)),
    max(1.0 - smoothstep(0.0, 0.002, uv.y), 1.0 - smoothstep(0.0, 0.002, 1.0 - uv.y))
  );
  color = mix(color, vec3f(0.24, 0.38, 0.37), edge * 0.35);
  let dither = (hash21(position.xy) - 0.5) / 255.0;
  return vec4f(max(color + dither, vec3f(0.0)), 1.0);
}
`;

export const maskShader = /* wgsl */ `
${COMMON}
${FULLSCREEN_VERTEX}

@fragment
fn fragmentMain(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.resolution;
  let p = uvToWorld(uv);
  let code = maskAt(p);
  return vec4f(f32(code) / 255.0, 0.0, 0.0, 1.0);
}
`;
