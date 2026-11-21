export const solidVertexShader = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uViewProjection;

out vec3 vWorldPosition;
out vec3 vNormal;

void main() {
  vWorldPosition = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

export const solidFragmentShader = `#version 300 es
precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;

uniform vec3 uColor;
uniform vec3 uCameraPosition;

out vec4 outColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  vec3 keyDirection = normalize(vec3(-0.42, 0.82, 0.55));
  vec3 fillDirection = normalize(vec3(0.72, 0.22, -0.42));
  float key = max(dot(normal, keyDirection), 0.0);
  float fill = max(dot(normal, fillDirection), 0.0);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.4);
  vec3 lit = uColor * (0.235 + key * 0.72 + fill * 0.16);
  lit += vec3(0.16, 0.30, 0.40) * rim * 0.22;
  outColor = vec4(pow(lit, vec3(0.92)), 1.0);
}
`;

export const edgeVertexShader = `#version 300 es
layout(location = 0) in vec3 aStart;
layout(location = 1) in vec3 aEnd;
layout(location = 2) in float aSide;
layout(location = 3) in float aT;

uniform mat4 uViewProjection;
uniform vec2 uViewport;
uniform float uPixelWidth;
uniform float uNear;

void main() {
  vec4 startClip = uViewProjection * vec4(aStart, 1.0);
  vec4 endClip = uViewProjection * vec4(aEnd, 1.0);
  if (startClip.w <= uNear || endClip.w <= uNear) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 startNdc = startClip.xy / startClip.w;
  vec2 endNdc = endClip.xy / endClip.w;
  vec2 halfViewport = uViewport * 0.5;
  vec2 startScreen = startNdc * halfViewport;
  vec2 endScreen = endNdc * halfViewport;
  vec2 direction = endScreen - startScreen;
  float screenLength = length(direction);
  if (screenLength < 1e-5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 tangent = direction / screenLength;
  vec2 normal = vec2(-tangent.y, tangent.x);
  vec4 baseClip = mix(startClip, endClip, aT);
  vec2 screenPosition = mix(startScreen, endScreen, aT);
  screenPosition += normal * aSide * uPixelWidth * 0.5;
  vec2 ndcPosition = screenPosition / halfViewport;

  gl_Position = vec4(ndcPosition * baseClip.w, baseClip.z, baseClip.w);
}
`;

export const edgeFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uSceneDepth;
uniform vec2 uViewport;
uniform float uSplitX;
uniform float uTolerance;
uniform float uDepthLevels;
uniform float uOffsetWorld;
uniform float uNear;
uniform float uFar;
uniform vec3 uOffsetColor;
uniform vec3 uDepthColor;
uniform int uMode;

out vec4 outColor;

float distanceFromDepth(float depth) {
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

float depthFromDistance(float distance) {
  if (distance <= uNear) return 0.0;
  return (uFar * (distance - uNear)) / (distance * (uFar - uNear));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float sceneDepth = texture(uSceneDepth, uv).r;
  float baseDepth = gl_FragCoord.z;
  float offsetDepth = depthFromDistance(distanceFromDepth(baseDepth) - uOffsetWorld);

  bool offsetVisible = sceneDepth > 0.999999
    ? offsetDepth < 1.0
    : (sceneDepth - offsetDepth) * uDepthLevels >= 1.5;
  bool depthVisible = baseDepth <= sceneDepth + uTolerance;
  int mode = uMode;
  if (mode == 2) {
    mode = gl_FragCoord.x < uSplitX ? 0 : 1;
  }
  if (mode == 0 && !offsetVisible) discard;
  if (mode == 1 && !depthVisible) discard;

  vec3 lineColor = mode == 0 ? uOffsetColor : uDepthColor;
  outColor = vec4(lineColor, 0.94);
}
`;

export const blitVertexShader = `#version 300 es
out vec2 vUv;

void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const blitFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uColor;
out vec4 outColor;

void main() {
  outColor = vec4(texture(uColor, vUv).rgb, 1.0);
}
`;
