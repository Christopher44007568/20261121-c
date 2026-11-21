const hizSamplers = Array.from({ length: 9 }, (_, i) => `uniform sampler2D uHiZ${i};`).join("\n");
const hizBranches = Array.from(
  { length: 9 },
  (_, i) => `  if (level == ${i}) return texture(uHiZ${i}, uv).r;`
).join("\n");

export const contactTraceFS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
${hizSamplers}
uniform mat4 uViewProj;
uniform mat4 uInvViewProj;
uniform vec3 uLightDir;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uRayLength;
uniform float uThickness;
uniform float uDepthBias;
uniform int uMaxMip;
out vec4 outTrace;

float sampleHiZ(vec2 uv, int level) {
${hizBranches}
  return 1.0;
}

float linearDistance(float raw) {
  // raw is reverse-Z: 1 = near, 0 = far. This inverse is valid for the
  // [near, far] WebGL depth range without first flipping the depth buffer.
  float denom = raw * (uFar - uNear) + uNear;
  return (uNear * uFar) / max(denom, 1e-6);
}

float rayRawDepth(vec3 world, out vec3 clip) {
  vec4 c = uViewProj * vec4(world, 1.0);
  clip = c.xyz / c.w;
  return c.z / c.w * 0.5 + 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float surfaceRaw = texture(uDepth, uv).r;
  if (surfaceRaw <= 0.000001) {
    outTrace = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 N = normalize(texture(uNormal, uv).xyz * 2.0 - 1.0);
  vec4 ndc = vec4(uv * 2.0 - 1.0, surfaceRaw * 2.0 - 1.0, 1.0);
  vec4 worldH = uInvViewProj * ndc;
  vec3 surface = worldH.xyz / worldH.w;
  vec3 rayOrigin = surface + N * 0.014 + uLightDir * 0.004;
  vec3 rayEnd = rayOrigin + uLightDir * uRayLength;

  vec4 a = uViewProj * vec4(rayOrigin, 1.0);
  vec4 b = uViewProj * vec4(rayEnd, 1.0);
  if (a.w <= 1e-4 || b.w <= 1e-4) {
    outTrace = vec4(0.0, 2.0 / 255.0, 0.0, 1.0);
    return;
  }

  vec2 startUV = a.xy / a.w * 0.5 + 0.5;
  vec2 endUV = b.xy / b.w * 0.5 + 0.5;
  vec2 delta = endUV - startUV;
  float tExit = 1.0;
  bool clipped = any(lessThan(startUV, vec2(0.0))) || any(greaterThan(startUV, vec2(1.0)));
  if (delta.x > 1e-7) tExit = min(tExit, (1.0 - startUV.x) / delta.x);
  if (delta.x < -1e-7) tExit = min(tExit, -startUV.x / delta.x);
  if (delta.y > 1e-7) tExit = min(tExit, (1.0 - startUV.y) / delta.y);
  if (delta.y < -1e-7) tExit = min(tExit, -startUV.y / delta.y);
  clipped = clipped || tExit < 0.9995;
  tExit = clamp(tExit, 0.0, 1.0);

  float screenLength = length(delta * uResolution);
  if (clipped && tExit <= 0.0001) {
    outTrace = vec4(0.0, 2.0 / 255.0, 0.0, 1.0);
    return;
  }
  if (screenLength < 1.0) {
    outTrace = vec4(0.0, 2.0 / 255.0, 0.0, 1.0);
    return;
  }

  float t = min(1.5 / max(screenLength, 1.0), tExit);
  int mip = 1;
  int steps = 0;
  int basis = 0;
  int hitMip = 0;
  float gap = 0.0;
  float visibility = 1.0;

  for (int i = 0; i < 56; i++) {
    steps = i + 1;
    float cellPixels = exp2(float(mip));
    float stepPixels = max(1.15, cellPixels * 0.82);
    float nextT = min(tExit, t + stepPixels / screenLength);
    if (nextT <= t + 1e-6) break;

    vec2 sampleUV = clamp(
      startUV + delta * nextT,
      vec2(0.5) / uResolution,
      1.0 - vec2(0.5) / uResolution
    );
    vec3 clip;
    float rayRaw = rayRawDepth(mix(rayOrigin, rayEnd, nextT), clip);
    float sceneRaw = sampleHiZ(sampleUV, mip);

    if (sceneRaw > 0.000001 && sceneRaw > rayRaw + uDepthBias) {
      if (mip > 0) {
        mip -= 1;
        continue;
      }
      // sceneRaw is larger in reverse-Z, therefore the scene surface is nearer
      // to the camera than the ray sample. The positive penetration is ray minus
      // scene, not scene minus ray.
      float distanceGap = linearDistance(rayRaw) - linearDistance(sceneRaw);
      if (distanceGap >= 0.0 && distanceGap <= uThickness) {
        basis = 1;
        hitMip = 0;
        gap = distanceGap;
        visibility = 0.16;
        break;
      }
      // The ray is behind a depth discontinuity too thick for a contact.
      t = nextT;
      mip = 1;
    } else {
      t = nextT;
      mip = min(mip + 1, uMaxMip);
    }
  }

  if (basis == 0) {
    basis = clipped ? 2 : 3;
    hitMip = mip;
    visibility = 1.0;
  }

  float packedBasis = float(basis + hitMip * 8) / 255.0;
  outTrace = vec4(
    float(steps) / 63.0,
    packedBasis,
    clamp(gap / 0.25, 0.0, 1.0),
    visibility
  );
}
`;
