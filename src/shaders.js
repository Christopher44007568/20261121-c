export const TRANSFORM_GLSL = `
uniform int uMode;
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform mat3 uRot;

vec3 resolveView(vec3 eyeRelative, vec3 ecefHigh, vec3 ecefLow) {
  if (uMode == 0) {
    return eyeRelative;
  }
  vec3 relativeEcef = (ecefHigh - uCamHi) + (ecefLow - uCamLo);
  return uRot * relativeEcef;
}
`;

export const MARKER_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aView;
layout(location = 1) in vec3 aHigh;
layout(location = 2) in vec3 aLow;
layout(location = 3) in vec2 aCorner;
layout(location = 4) in float aSize;
layout(location = 5) in vec3 aColor;
layout(location = 6) in vec3 aIdColor;

uniform mat4 uProjection;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uGlowPass;
uniform float uPickPass;

${TRANSFORM_GLSL}

out vec2 vCorner;
out vec3 vColor;
out vec3 vIdColor;

void main() {
  vec3 view = resolveView(aView, aHigh, aLow);
  vec4 clip = uProjection * vec4(view, 1.0);
  if (clip.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCorner = vec2(0.0);
    vColor = vec3(0.0);
    vIdColor = vec3(0.0);
    return;
  }
  float sizePx = aSize * uPixelRatio;
  if (uGlowPass > 0.5) sizePx *= 2.05;
  if (uPickPass > 0.5) sizePx = 9.2 * uPixelRatio;
  clip.xy += aCorner * (sizePx / uViewport) * 2.0 * clip.w;
  gl_Position = clip;
  vCorner = aCorner;
  vColor = aColor;
  vIdColor = aIdColor;
}
`;

export const MARKER_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vCorner;
in vec3 vColor;
in vec3 vIdColor;

uniform float uGlowPass;
uniform float uPickPass;
uniform float uAlpha;

out vec4 outColor;

void main() {
  float radius = length(vCorner);
  if (radius > 1.0) discard;
  if (uPickPass > 0.5) {
    outColor = vec4(vIdColor, 1.0);
    return;
  }
  float feather = 1.0 - smoothstep(0.68, 1.0, radius);
  if (uGlowPass > 0.5) {
    float glow = pow(max(0.0, 1.0 - radius), 2.4);
    outColor = vec4(vColor, glow * 0.22 * uAlpha);
    return;
  }
  vec3 core = mix(vColor, vec3(1.0), smoothstep(0.38, 0.08, radius) * 0.34);
  outColor = vec4(core, feather * uAlpha);
}
`;

export const LINE_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aView;
layout(location = 1) in vec3 aHigh;
layout(location = 2) in vec3 aLow;
layout(location = 3) in float aAlpha;

uniform mat4 uProjection;

${TRANSFORM_GLSL}

out float vAlpha;

void main() {
  vec3 view = resolveView(aView, aHigh, aLow);
  gl_Position = uProjection * vec4(view, 1.0);
  vAlpha = aAlpha;
}
`;

export const LINE_FRAGMENT = `#version 300 es
precision highp float;

in float vAlpha;
uniform vec3 uLineColor;
uniform float uLineAlpha;
out vec4 outColor;

void main() {
  outColor = vec4(uLineColor, vAlpha * uLineAlpha);
}
`;
