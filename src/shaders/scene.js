export const fullscreenVS = `#version 300 es
precision highp float;
out vec2 vUv;

void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0,
                gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const sceneVS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;

void main() {
  vWorld = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

export const sceneFS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
in vec3 vWorld;
in vec3 vNormal;
uniform int uMaterial;

vec3 groundAlbedo(vec3 p) {
  vec2 coord = p.xz / 0.5;
  vec2 width = fwidth(coord);
  vec2 g = abs(fract(coord - 0.5) - 0.5) / max(width, vec2(1e-5));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float axis = 1.0 - smoothstep(0.0, 1.5, length(coord));
  vec3 base = vec3(0.185, 0.205, 0.215);
  vec3 fine = base + line * vec3(0.085, 0.095, 0.098);
  fine += axis * vec3(0.018, 0.02, 0.02);
  return fine;
}

vec3 rodAlbedo(vec3 p) {
  float grain = 0.92 + 0.08 * sin(p.y * 42.0 + sin(p.x * 30.0));
  float seam = smoothstep(0.02, 0.0, abs(fract(p.y * 1.9) - 0.5) - 0.46);
  return vec3(0.29, 0.125, 0.045) * grain * (0.86 + seam * 0.14);
}

vec3 wallAlbedo(vec3 p) {
  float panel = smoothstep(0.012, 0.0, abs(fract(p.x * 0.85) - 0.5) - 0.47);
  float band = smoothstep(0.018, 0.0, abs(p.y - 2.15));
  vec3 base = vec3(0.088, 0.105, 0.112);
  return base + (panel + band) * vec3(0.018, 0.022, 0.025);
}

void main() {
  vec3 albedo;
  if (uMaterial == 0) {
    albedo = groundAlbedo(vWorld);
  } else if (uMaterial == 1) {
    albedo = rodAlbedo(vWorld);
  } else {
    albedo = wallAlbedo(vWorld);
  }
  vec3 n = normalize(vNormal);
  gAlbedo = vec4(albedo, 1.0);
  gNormal = vec4(n * 0.5 + 0.5, float(uMaterial) / 255.0);
}
`;

export const depthCopyFS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
in vec2 vUv;
out vec4 outColor;

void main() {
  // Preserve reverse-Z values verbatim. 1.0 is near, 0.0 is the far plane.
  outColor = vec4(texture(uDepth, vUv).r, 0.0, 0.0, 1.0);
}
`;

export const depthDownsampleFS = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform ivec2 uSourceSize;
uniform ivec2 uDestSize;
out vec4 outColor;

void main() {
  ivec2 dst = ivec2(gl_FragCoord.xy);
  ivec2 src = dst * 2;
  ivec2 maxCoord = uSourceSize - 1;
  float a = texelFetch(uSource, min(src, maxCoord), 0).r;
  float b = texelFetch(uSource, min(src + ivec2(1, 0), maxCoord), 0).r;
  float c = texelFetch(uSource, min(src + ivec2(0, 1), maxCoord), 0).r;
  float d = texelFetch(uSource, min(src + ivec2(1, 1), maxCoord), 0).r;
  // Reverse-Z: the maximum is the nearest sample. A max pyramid is therefore
  // conservative for occlusion tests and mirrors hardware Hi-Z traversal.
  float nearest = max(max(a, b), max(c, d));
  outColor = vec4(nearest, 0.0, 0.0, 1.0);
}
`;
