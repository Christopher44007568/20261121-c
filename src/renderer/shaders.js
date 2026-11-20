export const fullscreenVertex = `#version 300 es
in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const paperFragment = `#version 300 es
precision highp float;

in vec2 vUv;
uniform vec2 uSize;
uniform float uAngle;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 px = vUv * uSize;
  float curl = (fbm(px * 0.011) - 0.5) * 0.24;
  curl += (fbm(px * 0.043 + 8.0) - 0.5) * 0.08;
  float angle = uAngle + curl;
  vec2 fiber = vec2(cos(angle), sin(angle));
  vec2 across = vec2(-fiber.y, fiber.x);

  float along = dot(px, fiber);
  float cross = dot(px, across);
  float threadNoise = fbm(vec2(along * 0.028, cross * 0.11));
  float phase = cross * 0.72 + threadNoise * 9.0 + sin(along * 0.019) * 0.55;
  float threads = 0.5 + 0.5 * sin(phase);
  float fine = 0.5 + 0.5 * sin(cross * 2.15 + threadNoise * 17.0);
  float broken = smoothstep(0.2, 0.82, fbm(vec2(along * 0.075, cross * 0.24) + 21.0));
  float fiberStrength = smoothstep(0.7, 0.985, threads) * broken;
  fiberStrength += smoothstep(0.88, 0.995, fine) * 0.22;
  fiberStrength = clamp(fiberStrength, 0.0, 1.0);

  float grainA = hash21(px * 1.17);
  float grainB = fbm(px * 0.18 + 4.0);
  float grain = clamp(grainA * 0.42 + grainB * 0.58, 0.0, 1.0);
  float fleck = smoothstep(0.985, 1.0, hash21(px * 0.73 + 19.0));
  grain = clamp(grain + fleck * 0.22, 0.0, 1.0);

  outColor = vec4(
    cos(angle) * 0.5 + 0.5,
    sin(angle) * 0.5 + 0.5,
    fiberStrength,
    grain
  );
}
`;

export const fluxFragment = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uMobile;
uniform sampler2D uPaper;
uniform vec2 uSize;
uniform vec2 uDir;
uniform float uAnisotropy;
uniform float uPigmentMobility;
uniform float uWaterMobility;
out vec4 outFlux;

float fiberWeight(vec2 edgeDir, vec2 fiber) {
  float alignment = dot(edgeDir, fiber);
  float directional = 0.085 + 1.83 * alignment * alignment;
  return mix(1.0, directional, uAnisotropy);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 limit = ivec2(uSize) - 1;
  if ((uDir.x > 0.5 && cell.x >= limit.x) || (uDir.y > 0.5 && cell.y >= limit.y)) {
    outFlux = vec4(0.0);
    return;
  }

  vec2 texel = 1.0 / uSize;
  vec4 self = texture(uMobile, vUv);
  vec4 next = texture(uMobile, vUv + uDir * texel);
  vec4 paper = texture(uPaper, vUv);
  vec2 fiber = normalize(vec2(paper.r - 0.5, paper.g - 0.5) * 2.0 + vec2(0.00001));
  float weight = fiberWeight(uDir, fiber);
  float wet = smoothstep(0.002, 0.075, min(self.a, next.a));

  vec3 pigmentFlux = uPigmentMobility * weight * wet * (self.rgb - next.rgb);
  float waterFlux = uWaterMobility * weight * (self.a - next.a);
  outFlux = vec4(pigmentFlux, waterFlux);
}
`;

export const integrateFragment = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uMobile;
uniform sampler2D uDeposit;
uniform sampler2D uFaceH;
uniform sampler2D uFaceV;
uniform sampler2D uPaper;
uniform vec2 uSize;
uniform float uEvaporation;
uniform float uDepositRate;
uniform float uLiftRate;
layout(location = 0) out vec4 outMobile;
layout(location = 1) out vec4 outDeposit;

void main() {
  vec2 texel = 1.0 / uSize;
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 self = texture(uMobile, vUv);
  vec3 deposit = texture(uDeposit, vUv).rgb;
  vec4 right = texture(uFaceH, vUv);
  vec4 down = texture(uFaceV, vUv);
  vec4 left = cell.x > 0 ? texture(uFaceH, vUv - vec2(texel.x, 0.0)) : vec4(0.0);
  vec4 up = cell.y > 0 ? texture(uFaceV, vUv - vec2(0.0, texel.y)) : vec4(0.0);

  vec3 pigment = max(self.rgb + left.rgb + up.rgb - right.rgb - down.rgb, vec3(0.0));
  float water = max(self.a + left.a + up.a - right.a - down.a, 0.0);
  water *= exp(-uEvaporation);

  vec4 paper = texture(uPaper, vUv);
  float wet = smoothstep(0.015, 0.52, water);
  float dryness = 1.0 - wet;
  float grain = 0.78 + paper.a * 0.44;
  float settle = clamp(uDepositRate * grain * (0.16 + 0.84 * dryness), 0.0, 0.32);
  float lift = clamp(uLiftRate * wet * (1.0 - settle), 0.0, 0.36);

  vec3 settled = pigment * settle;
  vec3 lifted = deposit * lift;
  outMobile = vec4(pigment - settled + lifted, water);
  outDeposit = vec4(deposit - lifted + settled, 1.0);
}
`;

export const brushVertex = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aSegment;
layout(location = 2) in vec4 aBrush;
layout(location = 3) in vec3 aAbsorbance;
uniform vec2 uSize;

out vec2 vUv;
out vec2 vPoint;
flat out vec2 vStart;
flat out vec2 vEnd;
flat out float vRadius;
flat out float vMode;
flat out float vPigment;
flat out float vWater;
flat out vec3 vAbsorbance;

void main() {
  vec2 start = aSegment.xy;
  vec2 end = aSegment.zw;
  float radius = aBrush.x;
  float pad = radius + 3.0;
  vec2 low = min(start, end) - pad;
  vec2 high = max(start, end) + pad;
  vec2 point = mix(low, high, aPos * 0.5 + 0.5);

  vUv = point / uSize;
  vPoint = point;
  vStart = start;
  vEnd = end;
  vRadius = radius;
  vMode = aBrush.y;
  vPigment = aBrush.z;
  vWater = aBrush.w;
  vAbsorbance = aAbsorbance;
  gl_Position = vec4(point / uSize * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const brushFragment = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vPoint;
flat in vec2 vStart;
flat in vec2 vEnd;
flat in float vRadius;
flat in float vMode;
flat in float vPigment;
flat in float vWater;
flat in vec3 vAbsorbance;
uniform sampler2D uMobile;
uniform sampler2D uDeposit;
uniform sampler2D uPaper;
layout(location = 0) out vec4 outMobile;
layout(location = 1) out vec4 outDeposit;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float denominator = max(dot(ab, ab), 0.00001);
  float t = clamp(dot(p - a, ab) / denominator, 0.0, 1.0);
  return length(p - (a + ab * t));
}

void main() {
  float distanceToStroke = segmentDistance(vPoint, vStart, vEnd);
  float feather = max(1.15, vRadius * 0.2);
  float mask = 1.0 - smoothstep(vRadius - feather, vRadius, distanceToStroke);
  if (mask <= 0.0) discard;

  vec4 paper = texture(uPaper, vUv);
  float grainMod = mix(0.76, 1.18, paper.a);
  float edgeBreak = mix(0.78, 1.04, paper.b);
  mask *= grainMod * edgeBreak;
  vec4 cell = texture(uMobile, vUv);
  vec3 deposit = texture(uDeposit, vUv).rgb;

  if (vMode < 0.5) {
    cell.rgb += vAbsorbance * vPigment * mask;
    cell.a += vWater * mask;
  } else {
    float lift = clamp(0.1 + vWater * 0.18, 0.0, 0.42) * mask;
    vec3 lifted = deposit * lift;
    cell.rgb += lifted;
    deposit -= lifted;
    cell.a += vWater * mask * 0.88;
  }
  cell.a = min(cell.a, 4.0);
  outMobile = cell;
  outDeposit = vec4(deposit, 1.0);
}
`;

export const presentFragment = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uMobile;
uniform sampler2D uDeposit;
uniform sampler2D uPaper;
uniform vec2 uViewport;
uniform vec2 uSimSize;
uniform vec2 uPan;
uniform float uZoom;
uniform float uShowFibers;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 screenUv = vUv;
  vec2 simUv = (screenUv - 0.5) / uZoom + 0.5 + uPan;
  if (simUv.x < 0.0 || simUv.y < 0.0 || simUv.x > 1.0 || simUv.y > 1.0) {
    float grid = step(0.985, fract(screenUv.x * uViewport.x / 32.0));
    grid += step(0.985, fract(screenUv.y * uViewport.y / 32.0));
    vec3 desk = vec3(0.075, 0.083, 0.074) + grid * 0.008;
    outColor = vec4(desk, 1.0);
    return;
  }

  vec4 paperData = texture(uPaper, simUv);
  vec4 mobile = texture(uMobile, simUv);
  vec3 deposit = texture(uDeposit, simUv).rgb;
  float wet = clamp(mobile.a, 0.0, 4.0);

  float grain = paperData.a;
  float fiber = paperData.b;
  vec3 paperColor = vec3(0.918, 0.879, 0.785);
  paperColor *= 0.955 + grain * 0.065;
  paperColor += vec3(0.05, 0.044, 0.033) * (fiber - 0.28) * 0.28;
  paperColor -= vec3(0.018, 0.014, 0.007) * smoothstep(0.72, 1.0, grain);

  vec3 opticalDensity = deposit * 1.08 + mobile.rgb * 0.91;
  opticalDensity *= mix(0.84, 1.14, grain);
  vec3 transmittance = exp(-opticalDensity * vec3(3.08, 2.86, 2.6));
  vec3 color = paperColor * transmittance;

  float wetMask = smoothstep(0.025, 0.72, wet);
  float wetRim = smoothstep(0.015, 0.09, wet) * (1.0 - smoothstep(0.09, 0.28, wet));
  color = mix(color, color * vec3(0.955, 0.974, 0.985), wetMask * 0.56);
  color += vec3(0.09, 0.105, 0.105) * pow(wetMask, 4.0) * 0.055;
  color -= vec3(0.016, 0.013, 0.007) * wetRim;

  vec2 fiberDirection = normalize(vec2(paperData.r - 0.5, paperData.g - 0.5) * 2.0 + vec2(0.00001));
  vec2 acrossFiber = vec2(-fiberDirection.y, fiberDirection.x);
  float fiberField = 0.5 + 0.5 * sin(dot(simUv * uSimSize, acrossFiber) * 1.12 + paperData.b * 17.0);
  color += (fiberField - 0.42) * 0.028 * uShowFibers * (0.35 + paperData.b);
  color *= 1.0 - mobile.a * 0.0025;
  float vignette = 1.0 - smoothstep(0.24, 0.82, length(simUv - 0.5));
  color *= mix(0.965, 1.0, vignette);

  float outside = 1.0 - smoothstep(0.0, 0.0025, min(min(simUv.x, 1.0 - simUv.x), min(simUv.y, 1.0 - simUv.y)));
  color = mix(color, color * 0.72, outside);
  outColor = vec4(color, 1.0);
}
`;
