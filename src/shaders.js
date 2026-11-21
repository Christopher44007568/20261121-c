export const WGSL = /* wgsl */ `
struct Uniforms {
  camPos: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  camFwd: vec4f,
  lightCenter: vec4f,
  lightSize: vec4f,
  board: vec4f,
  board2: vec4f,
  params: vec4f,
  params2: vec4f,
  reference: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var previous: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(1) @binding(0) var referenceTex: texture_2d<f32>;

const PI: f32 = 3.14159265;
const KIND_FLOOR: u32 = 1u;
const KIND_BOARD: u32 = 2u;
const KIND_LIGHT: u32 = 3u;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

struct Hit {
  t: f32,
  kind: u32,
  position: vec3f,
  normal: vec3f,
};

fn boxBounds() -> array<vec3f, 2> {
  let bmin = vec3f(u.board.x - u.board.y, u.board.z, u.board2.x - u.board2.y);
  let bmax = vec3f(u.board.x + u.board.y, u.board.w, u.board2.x + u.board2.y);
  return array<vec3f, 2>(bmin, bmax);
}

fn rayBox(origin: vec3f, direction: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv = 1.0 / direction;
  let t0 = (bmin - origin) * inv;
  let t1 = (bmax - origin) * inv;
  let low = min(t0, t1);
  let high = max(t0, t1);
  let near = max(max(low.x, low.y), low.z);
  let far = min(min(high.x, high.y), high.z);
  if (near > far || far < 0.0001) {
    return vec2f(-1.0, -1.0);
  }
  return vec2f(near, far);
}

fn segmentBlocked(origin: vec3f, lightPoint: vec3f, bmin: vec3f, bmax: vec3f) -> bool {
  let direction = lightPoint - origin;
  let inv = 1.0 / direction;
  let t0 = (bmin - origin) * inv;
  let t1 = (bmax - origin) * inv;
  let low = min(t0, t1);
  let high = max(t0, t1);
  let near = max(max(low.x, low.y), low.z);
  let far = min(min(high.x, high.y), high.z);
  return near <= far && far > 0.0001 && near < 0.9999;
}

fn boxNormal(point: vec3f, bmin: vec3f, bmax: vec3f) -> vec3f {
  let center = (bmin + bmax) * 0.5;
  let halfExtent = max((bmax - bmin) * 0.5, vec3f(0.0001));
  let local = (point - center) / halfExtent;
  let absolute = abs(local);
  if (absolute.x > absolute.y && absolute.x > absolute.z) {
    return vec3f(sign(local.x), 0.0, 0.0);
  }
  if (absolute.y > absolute.z) {
    return vec3f(0.0, sign(local.y), 0.0);
  }
  return vec3f(0.0, 0.0, sign(local.z));
}

fn hashUint(valueIn: u32) -> u32 {
  var value = valueIn;
  value = (value ^ 61u) ^ (value >> 16u);
  value *= 9u;
  value = value ^ (value >> 4u);
  value *= 0x27d4eb2du;
  value = value ^ (value >> 15u);
  return value;
}

fn random01(seed: u32) -> f32 {
  return f32(hashUint(seed)) / 4294967295.0;
}

fn pixelSeed(pixel: vec2f, frame: u32, lane: u32) -> u32 {
  let x = u32(pixel.x) * 1973u;
  let y = u32(pixel.y) * 9277u;
  return hashUint(x + y + frame * 26699u + lane * 8191u + 1u);
}

fn traceRay(origin: vec3f, direction: vec3f) -> Hit {
  var best = Hit(1e20, 0u, vec3f(0.0), vec3f(0.0, 1.0, 0.0));
  let bounds = boxBounds();

  if (direction.y < -0.00001) {
    let floorT = -origin.y / direction.y;
    if (floorT > 0.0001 && floorT < best.t) {
      best.t = floorT;
      best.kind = KIND_FLOOR;
      best.position = origin + direction * floorT;
      best.normal = vec3f(0.0, 1.0, 0.0);
    }
  }

  let boardHit = rayBox(origin, direction, bounds[0], bounds[1]);
  if (boardHit.x > 0.0001 && boardHit.x < best.t) {
    best.t = boardHit.x;
    best.kind = KIND_BOARD;
    best.position = origin + direction * boardHit.x;
    best.normal = boxNormal(best.position, bounds[0], bounds[1]);
  }

  let planeT = (u.lightCenter.y - origin.y) / direction.y;
  if (abs(direction.y) > 0.00001 && planeT > 0.0001 && planeT < best.t) {
    let point = origin + direction * planeT;
    if (abs(point.x - u.lightCenter.x) <= u.lightSize.x &&
        abs(point.z - u.lightCenter.z) <= u.lightSize.y) {
      best.t = planeT;
      best.kind = KIND_LIGHT;
      best.position = point;
      best.normal = vec3f(0.0, -1.0, 0.0);
    }
  }
  return best;
}

fn sampleAreaLight(position: vec3f, seed: u32, sampleCount: u32) -> f32 {
  let bounds = boxBounds();
  let origin = position + vec3f(0.0, 0.002, 0.0);
  var visible = 0.0;
  for (var index = 0u; index < sampleCount; index += 1u) {
    let ux = random01(seed + index * 2u + 11u);
    let uz = random01(seed + index * 2u + 23u);
    let lightPoint = vec3f(
      u.lightCenter.x + (ux * 2.0 - 1.0) * u.lightSize.x,
      u.lightCenter.y,
      u.lightCenter.z + (uz * 2.0 - 1.0) * u.lightSize.y
    );
    if (!segmentBlocked(origin, lightPoint, bounds[0], bounds[1])) {
      visible += 1.0;
    }
  }
  return visible / f32(sampleCount);
}

fn sampleAreaLightHQ(position: vec3f, seed: u32) -> f32 {
  let bounds = boxBounds();
  let origin = position + vec3f(0.0, 0.002, 0.0);
  var visible = 0.0;
  for (var index = 0u; index < 256u; index += 1u) {
    let gx = f32(index % 16u);
    let gy = f32(index / 16u);
    let ux = (gx + random01(seed + index * 3u + 7u)) / 16.0;
    let uz = (gy + random01(seed + index * 3u + 19u)) / 16.0;
    let lightPoint = vec3f(
      u.lightCenter.x + (ux * 2.0 - 1.0) * u.lightSize.x,
      u.lightCenter.y,
      u.lightCenter.z + (uz * 2.0 - 1.0) * u.lightSize.y
    );
    if (!segmentBlocked(origin, lightPoint, bounds[0], bounds[1])) {
      visible += 1.0;
    }
  }
  return visible / 256.0;
}

fn rayDirection(uv: vec2f) -> vec3f {
  let sx = (uv.x * 2.0 - 1.0) * u.camRight.w * u.camUp.w;
  let sy = (1.0 - uv.y * 2.0) * u.camRight.w;
  return normalize(u.camFwd.xyz + u.camRight.xyz * sx + u.camUp.xyz * sy);
}

fn pixelUv(position: vec4f, jitter: vec2f) -> vec2f {
  return (position.xy + jitter) / u.params2.xy;
}

fn gridMask(coord: vec2f, spacing: f32) -> f32 {
  let cell = coord / spacing;
  let distanceToLine = min(fract(cell), vec2f(1.0) - fract(cell));
  let lineX = 1.0 - smoothstep(0.0, 0.026, distanceToLine.x);
  let lineZ = 1.0 - smoothstep(0.0, 0.026, distanceToLine.y);
  return max(lineX, lineZ);
}

fn probeLines(z: f32) -> vec3f {
  var stripe = vec3f(0.0);
  let z0 = u.board2.x + 0.14;
  let z1 = u.board2.x + 0.30;
  let z2 = u.board2.x + 0.46;
  let z3 = u.board2.x + 0.62;
  let z4 = u.board2.x + 0.78;
  stripe += vec3f(0.18, 0.82, 0.94) * (1.0 - smoothstep(0.006, 0.015, abs(z - z0)));
  stripe += vec3f(0.23, 0.88, 0.70) * (1.0 - smoothstep(0.006, 0.015, abs(z - z1)));
  stripe += vec3f(0.52, 0.87, 0.42) * (1.0 - smoothstep(0.006, 0.015, abs(z - z2)));
  stripe += vec3f(0.96, 0.76, 0.34) * (1.0 - smoothstep(0.006, 0.015, abs(z - z3)));
  stripe += vec3f(1.00, 0.54, 0.31) * (1.0 - smoothstep(0.006, 0.015, abs(z - z4)));
  return stripe;
}

fn shadeFloor(position: vec3f, viewDirection: vec3f, visibility: f32) -> vec3f {
  let toLight = u.lightCenter.xyz - position;
  let distanceSquared = dot(toLight, toLight);
  let distance = sqrt(distanceSquared);
  let cosine = max(toLight.y / max(distance, 0.001), 0.0);
  let lightArea = u.lightSize.x * u.lightSize.y * 4.0;
  let irradiance = lightArea * 7.4 * (0.45 + cosine * 0.55) / (distanceSquared + 0.35);
  let fineGrid = gridMask(position.xz, 0.25);
  let majorGrid = gridMask(position.xz, 1.0);
  let fade = exp(-length(position.xz - vec2f(0.0, 0.5)) * 0.081);
  var albedo = mix(vec3f(0.18, 0.22, 0.25), vec3f(0.32, 0.37, 0.41), fade);
  albedo += vec3f(0.12, 0.19, 0.22) * fineGrid * 0.08;
  albedo += vec3f(0.24, 0.34, 0.38) * majorGrid * 0.16;
  let ambient = vec3f(0.018, 0.026, 0.035) * (0.5 + cosine * 0.5);
  let direct = vec3f(1.0, 0.73, 0.42) * irradiance * visibility;
  let bounce = vec3f(0.04, 0.09, 0.12) * irradiance * visibility * 0.18;
  let probes = probeLines(position.z) * (0.065 + visibility * 0.06);
  return albedo * (direct + bounce + ambient) + probes;
}

fn shadeBoard(hit: Hit, viewDirection: vec3f) -> vec3f {
  let toLight = normalize(u.lightCenter.xyz - hit.position);
  let normal = normalize(hit.normal);
  let diffuse = max(dot(normal, toLight), 0.0);
  let facing = max(dot(-viewDirection, normal), 0.0);
  let rim = pow(1.0 - facing, 2.5);
  let vertical = clamp((hit.position.y - u.board.z) / 2.5, 0.0, 1.0);
  var base = mix(vec3f(0.038, 0.052, 0.068), vec3f(0.105, 0.13, 0.15), vertical);
  let horizontalLines = 1.0 - smoothstep(0.0, 0.027, abs(fract(hit.position.y * 2.2) - 0.5) - 0.47);
  let verticalLines = 1.0 - smoothstep(0.0, 0.026, abs(fract(hit.position.x * 1.7) - 0.5) - 0.48);
  base += vec3f(0.055, 0.10, 0.13) * horizontalLines * 0.12;
  base += vec3f(0.04, 0.07, 0.10) * verticalLines * 0.08;
  let bottomDistance = hit.position.y - u.board.z;
  let contact = exp(-bottomDistance * 7.0) * 0.07;
  let topEdge = smoothstep(0.025, 0.0, abs(hit.position.y - u.board.w)) * 0.12;
  let light = vec3f(1.0, 0.71, 0.40) * diffuse * 0.085;
  let edge = vec3f(0.25, 0.72, 0.84) * rim * 0.11;
  return base + light + edge + vec3f(1.0, 0.52, 0.22) * contact + vec3f(1.0, 0.72, 0.42) * topEdge;
}

fn shadeLight(hit: Hit) -> vec3f {
  let local = vec2f(
    abs(hit.position.x - u.lightCenter.x) / u.lightSize.x,
    abs(hit.position.z - u.lightCenter.z) / u.lightSize.y
  );
  let edge = min(1.0 - local.x, 1.0 - local.y);
  let border = 1.0 - smoothstep(0.0, 0.055, edge);
  let inner = 1.0 - smoothstep(0.0, 0.28, edge);
  let ribs = 1.0 - min(min(abs(fract(local.x * 8.0) - 0.5), abs(fract(local.y * 5.0) - 0.5)) * 8.0, 1.0);
  let warm = vec3f(1.0, 0.58, 0.22);
  let cream = vec3f(1.0, 0.88, 0.66);
  return mix(warm, cream, inner) * 2.7 + warm * border * 1.2 + cream * ribs * 0.12;
}

fn skyColor(direction: vec3f) -> vec3f {
  let vertical = clamp(direction.y * 1.4 + 0.2, 0.0, 1.0);
  var color = mix(vec3f(0.018, 0.027, 0.039), vec3f(0.035, 0.052, 0.069), vertical);
  let toLight = normalize(u.lightCenter.xyz - u.camPos.xyz);
  let alignment = max(dot(direction, toLight), 0.0);
  color += vec3f(1.0, 0.53, 0.20) * pow(alignment, 360.0) * 0.75;
  color += vec3f(1.0, 0.62, 0.29) * pow(alignment, 22.0) * 0.022;
  let horizon = exp(-abs(direction.y) * 20.0);
  color += vec3f(0.06, 0.095, 0.12) * horizon * 0.18;
  return color;
}

fn visibilityColor(value: f32) -> vec3f {
  let dark = vec3f(0.008, 0.018, 0.028);
  let mid = vec3f(0.025, 0.25, 0.31);
  let bright = vec3f(0.30, 0.94, 0.92);
  return mix(mix(dark, mid, smoothstep(0.0, 0.5, value)), bright, smoothstep(0.5, 1.0, value));
}

fn ageColor(age: f32) -> vec3f {
  let normalized = clamp(sqrt(age), 0.0, 1.0);
  let low = vec3f(0.018, 0.025, 0.05);
  let middle = vec3f(0.07, 0.35, 0.56);
  let high = vec3f(0.75, 0.96, 0.94);
  return mix(mix(low, middle, smoothstep(0.0, 0.58, normalized)), high, smoothstep(0.58, 1.0, normalized));
}

fn errorColor(value: f32) -> vec3f {
  let base = vec3f(0.018, 0.027, 0.037);
  let yellow = vec3f(0.84, 0.63, 0.17);
  let red = vec3f(1.0, 0.17, 0.12);
  return mix(mix(base, yellow, smoothstep(0.015, 0.22, value)), red, smoothstep(0.22, 0.75, value));
}

fn finishColor(colorIn: vec3f, uv: vec2f) -> vec3f {
  var color = 1.0 - exp(-max(colorIn, vec3f(0.0)) * 1.28);
  let centered = uv - vec2f(0.5);
  let vignette = 1.0 - dot(centered, centered) * 0.34;
  color *= vignette;
  let grain = (random01(pixelSeed(vec2f(uv * u.params2.xy), u32(u.params.x), 77u)) - 0.5) * 0.018;
  return max(color + grain, vec3f(0.0));
}

fn filteredVisibility(uv: vec2f) -> f32 {
  let texel = 1.0 / max(u.params2.xy, vec2f(1.0));
  let center = textureSampleLevel(previous, linearSampler, uv, 0.0).r;
  let left = textureSampleLevel(previous, linearSampler, uv - vec2f(texel.x * 1.35, 0.0), 0.0).r;
  let right = textureSampleLevel(previous, linearSampler, uv + vec2f(texel.x * 1.35, 0.0), 0.0).r;
  let up = textureSampleLevel(previous, linearSampler, uv - vec2f(0.0, texel.y * 1.35), 0.0).r;
  let down = textureSampleLevel(previous, linearSampler, uv + vec2f(0.0, texel.y * 1.35), 0.0).r;
  return center * 0.36 + (left + right + up + down) * 0.16;
}

@fragment
fn fs_accum(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = floor(position.xy);
  let seed = pixelSeed(pixel, u32(u.params.x), 0u);
  let jitter = vec2f(
    random01(seed + 3u) - 0.5,
    random01(seed + 5u) - 0.5
  );
  let ray = rayDirection(pixelUv(position, jitter));
  let hit = traceRay(u.camPos.xyz, ray);
  if (hit.kind != KIND_FLOOR) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }

  let sampleCount = max(u32(u.params.y), 1u);
  let current = sampleAreaLight(hit.position, seed, sampleCount);
  let old = textureLoad(previous, vec2i(pixel), 0);
  let reset = u.params.z > 0.5 || old.a < 0.5;
  let blend = select(u.params.w, 1.0, reset);
  let visibility = mix(old.r, current, blend);
  let increment = f32(sampleCount) / 128.0;
  let age = select(min(old.g + increment, 1.0), increment, reset);
  return vec4f(visibility, age, current, 1.0);
}

@fragment
fn fs_reference(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = floor(position.xy);
  let seed = pixelSeed(pixel, 73u, 5u);
  let jitter = vec2f(
    random01(seed + 3u) - 0.5,
    random01(seed + 5u) - 0.5
  );
  let ray = rayDirection(pixelUv(position, jitter));
  let hit = traceRay(u.camPos.xyz, ray);
  if (hit.kind != KIND_FLOOR) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }
  let visibility = sampleAreaLightHQ(hit.position, seed);
  return vec4f(visibility, 1.0, visibility, 1.0);
}

@fragment
fn fs_final(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / u.params2.xy;
  let ray = rayDirection(uv);
  let hit = traceRay(u.camPos.xyz, ray);
  let accumulated = textureSampleLevel(previous, linearSampler, uv, 0.0);
  let reference = textureSampleLevel(referenceTex, linearSampler, uv, 0.0);
  let mode = u32(u.params2.z + 0.5);
  let referenceReady = u.reference.z > 0.5;

  if (mode == 2u) {
    if (hit.kind == KIND_FLOOR) {
      let visibility = accumulated.r;
      var color = visibilityColor(visibility);
      let lowEdge = 1.0 - smoothstep(0.0, 0.018, abs(visibility - 0.05)) +
                    1.0 - smoothstep(0.0, 0.018, abs(visibility - 0.95));
      let middleEdge = 1.0 - smoothstep(0.0, 0.012, abs(visibility - 0.5));
      color += vec3f(0.50, 1.0, 0.93) * lowEdge * 0.7;
      color += vec3f(0.80, 0.92, 0.95) * middleEdge * 0.35;
      return vec4f(finishColor(color, uv), 1.0);
    }
    if (hit.kind == KIND_BOARD) {
      return vec4f(vec3f(0.004, 0.008, 0.011), 1.0);
    }
    if (hit.kind == KIND_LIGHT) {
      return vec4f(vec3f(0.38, 0.18, 0.06), 1.0);
    }
    return vec4f(vec3f(0.004, 0.006, 0.009), 1.0);
  }

  if (mode == 3u) {
    if (hit.kind == KIND_FLOOR) {
      let sampleAge = accumulated.g * 128.0;
      var color = ageColor(sampleAge / 64.0);
      let contour = 1.0 - smoothstep(0.0, 0.04, abs(fract(sampleAge / 4.0) - 0.5) - 0.46);
      color += vec3f(0.04, 0.14, 0.18) * contour;
      return vec4f(finishColor(color, uv), 1.0);
    }
    if (hit.kind == KIND_BOARD) {
      return vec4f(vec3f(0.009, 0.012, 0.017), 1.0);
    }
    if (hit.kind == KIND_LIGHT) {
      return vec4f(vec3f(0.18, 0.10, 0.04), 1.0);
    }
    return vec4f(vec3f(0.004, 0.006, 0.009), 1.0);
  }

  if (mode == 4u) {
    if (!referenceReady) {
      let hatch = f32((i32(position.x) / 14 + i32(position.y) / 14) & 1);
      return vec4f(mix(vec3f(0.018, 0.024, 0.03), vec3f(0.045, 0.055, 0.063), hatch), 1.0);
    }
    if (hit.kind == KIND_FLOOR) {
      let difference = abs(accumulated.r - reference.r);
      return vec4f(finishColor(errorColor(difference), uv), 1.0);
    }
    if (hit.kind == KIND_BOARD) {
      return vec4f(vec3f(0.006, 0.009, 0.013), 1.0);
    }
    if (hit.kind == KIND_LIGHT) {
      return vec4f(vec3f(0.16, 0.08, 0.03), 1.0);
    }
    return vec4f(vec3f(0.004, 0.006, 0.009), 1.0);
  }

  var visibility = filteredVisibility(uv);
  if (mode == 1u && uv.x > 0.5) {
    visibility = select(filteredVisibility(uv), reference.r, referenceReady);
  }

  var color: vec3f;
  if (hit.kind == KIND_FLOOR) {
    color = shadeFloor(hit.position, ray, visibility);
  } else if (hit.kind == KIND_BOARD) {
    color = shadeBoard(hit, ray);
  } else if (hit.kind == KIND_LIGHT) {
    color = shadeLight(hit);
  } else {
    color = skyColor(ray);
  }

  if (mode == 1u) {
    let dividerWidth = 1.35 / u.params2.x;
    let divider = 1.0 - smoothstep(0.0, dividerWidth, abs(uv.x - 0.5));
    color = mix(color, vec3f(0.87, 0.94, 1.0), divider * 0.8);
    if (uv.x > 0.5) {
      color *= vec3f(0.94, 0.98, 1.02);
    }
  }
  return vec4f(finishColor(color, uv), 1.0);
}
`;
