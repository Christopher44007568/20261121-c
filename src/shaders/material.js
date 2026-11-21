export const materialVertex = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aUseAlpha;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;
uniform vec2 uJitter;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vUseAlpha;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec4 clip = uViewProjection * world;
  clip.xy += uJitter * clip.w;
  vWorld = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUv = aUv;
  vUseAlpha = aUseAlpha;
  gl_Position = clip;
}`;

export const materialFragment = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vUseAlpha;

uniform sampler2D uMask;
uniform int uAlphaMode;
uniform float uThreshold;
uniform float uMipBias;
uniform vec3 uCamera;
uniform vec3 uTint;
uniform float uDebugHoles;

out vec4 outColor;

float bayer4(vec2 pixel) {
  ivec2 p = ivec2(mod(pixel, 4.0));
  float matrix[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (matrix[p.x + p.y * 4] + 0.5) / 16.0;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSrgb(vec3 x) {
  return pow(x, vec3(1.0 / 2.2));
}

void main() {
  float metal = vUseAlpha > 0.5 ? texture(uMask, vUv, uMipBias).r : 1.0;
  if (uDebugHoles > 0.5) {
    if (vUseAlpha > 0.5 && metal < uThreshold) discard;
    outColor = vec4(mix(vec3(0.05, 0.34, 0.42), vec3(0.92, 0.96, 0.98), metal), 1.0);
    return;
  }

  if (vUseAlpha > 0.5) {
    if (uAlphaMode == 0 && metal < uThreshold) discard;
    if (uAlphaMode == 1 && metal < bayer4(gl_FragCoord.xy)) discard;
  }

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamera - vWorld);
  vec3 L1 = normalize(vec3(-0.55, 0.75, 0.85));
  vec3 L2 = normalize(vec3(0.8, -0.2, 0.35));
  vec3 H1 = normalize(L1 + V);
  vec3 H2 = normalize(L2 + V);
  float NdotL1 = max(dot(N, L1), 0.0);
  float NdotL2 = max(dot(N, L2), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float fresnel = pow(1.0 - NdotV, 5.0);
  float grain = 0.94 + 0.06 * sin(vUv.x * 3100.0 + sin(vUv.y * 170.0) * 2.2);

  vec3 base = uTint * grain;
  vec3 diffuse = base * (0.14 + 0.54 * NdotL1 + 0.24 * NdotL2);
  vec3 env = mix(vec3(0.025, 0.04, 0.05), vec3(0.30, 0.42, 0.47), 0.5 + 0.5 * N.y);
  float spec1 = pow(max(dot(N, H1), 0.0), 92.0) * 1.8;
  float spec2 = pow(max(dot(N, H2), 0.0), 34.0) * 0.55;
  float rim = pow(1.0 - NdotV, 3.0) * (0.12 + 0.32 * NdotL1);
  vec3 color = diffuse + env * (0.28 + fresnel * 1.5) + vec3(spec1 + spec2) + vec3(0.36, 0.58, 0.62) * rim;
  color = toSrgb(aces(color));
  outColor = vec4(color, uAlphaMode == 2 ? mix(1.0, metal, vUseAlpha) : 1.0);
}`;

export const coverageFragment = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vUseAlpha;

uniform sampler2D uMask;
uniform int uAlphaMode;
uniform float uThreshold;
uniform float uMipBias;

out vec4 outColor;

float bayer4(vec2 pixel) {
  ivec2 p = ivec2(mod(pixel, 4.0));
  float matrix[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (matrix[p.x + p.y * 4] + 0.5) / 16.0;
}

void main() {
  float metal = vUseAlpha > 0.5 ? texture(uMask, vUv, uMipBias).r : 1.0;
  if (vUseAlpha > 0.5) {
    if (uAlphaMode == 0 && metal < uThreshold) discard;
    if (uAlphaMode == 1 && metal < bayer4(gl_FragCoord.xy)) discard;
  }
  outColor = vec4(1.0, 1.0, 1.0, uAlphaMode == 2 ? metal : 1.0);
}`;
