export const backgroundVertex = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const backgroundFragment = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / uResolution.y;

  float v = smoothstep(-0.95, 0.85, uv.y);
  vec3 low = vec3(0.018, 0.030, 0.036);
  vec3 high = vec3(0.065, 0.105, 0.115);
  vec3 color = mix(low, high, v);

  float amberGlow = exp(-length((p - vec2(0.38, -0.12)) * vec2(0.74, 1.05)) * 3.2);
  color += vec3(0.27, 0.115, 0.028) * amberGlow * 0.95;
  float cyanGlow = exp(-length((p - vec2(-0.48, 0.36)) * vec2(0.9, 1.3)) * 4.0);
  color += vec3(0.018, 0.11, 0.14) * cyanGlow;

  vec2 gridCoord = gl_FragCoord.xy / 40.0;
  vec2 gridLine = abs(fract(gridCoord - 0.5) - 0.5) / fwidth(gridCoord);
  float grid = 1.0 - min(min(gridLine.x, gridLine.y), 1.0);
  color += vec3(0.08, 0.17, 0.18) * grid * 0.16;

  float sweep = smoothstep(0.0, 1.0, 0.5 + 0.5 * sin((uv.x + uv.y) * 9.0 - uTime * 0.15));
  color += vec3(0.007, 0.012, 0.013) * sweep;
  color *= 0.78 + 0.22 * smoothstep(0.0, 0.72, 1.0 - length(p * vec2(0.7, 0.9)));
  outColor = vec4(color, 1.0);
}`;

export const blitVertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const blitFragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
out vec4 outColor;
void main() {
  outColor = texture(uSource, vUv);
}`;

export const solidVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform vec2 uJitter;
void main() {
  vec4 clip = uViewProjection * uModel * vec4(aPosition, 1.0);
  clip.xy += uJitter * clip.w;
  gl_Position = clip;
}`;

export const solidFragment = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;
