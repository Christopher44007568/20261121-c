export const geometryReferenceFS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform mat4 uInvViewProj;
uniform vec3 uLightDir;
uniform vec2 uResolution;
uniform float uRayLength;
uniform vec3 uRodBase;
uniform float uRodRadius;
uniform float uRodHeight;
uniform vec3 uWallMin;
uniform vec3 uWallMax;
out vec4 outReference;

float cylinderHit(vec3 ro, vec3 rd) {
  vec2 oc = ro.xz - uRodBase.xz;
  float a = dot(rd.xz, rd.xz);
  float b = 2.0 * dot(oc, rd.xz);
  float c = dot(oc, oc) - uRodRadius * uRodRadius;
  float disc = b * b - 4.0 * a * c;
  if (a < 1e-7 || disc < 0.0) return 1e9;
  float root = sqrt(disc);
  float t0 = (-b - root) / (2.0 * a);
  float t1 = (-b + root) / (2.0 * a);
  for (int i = 0; i < 2; i++) {
    float t = i == 0 ? t0 : t1;
    float y = ro.y + rd.y * t;
    if (t > 0.002 && y >= uRodBase.y && y <= uRodBase.y + uRodHeight) return t;
  }
  return 1e9;
}

float boxHit(vec3 ro, vec3 rd) {
  vec3 invD = 1.0 / max(abs(rd), vec3(1e-8)) * sign(rd + vec3(1e-8));
  vec3 ta = (uWallMin - ro) * invD;
  vec3 tb = (uWallMax - ro) * invD;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float enter = max(max(tmin.x, tmin.y), tmin.z);
  float leave = min(min(tmax.x, tmax.y), tmax.z);
  return enter <= leave && enter > 0.002 ? enter : 1e9;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float depth = texture(uDepth, uv).r;
  if (depth <= 0.000001) {
    outReference = vec4(1.0, 0.0, 0.0, 0.0);
    return;
  }
  vec3 N = normalize(texture(uNormal, uv).xyz * 2.0 - 1.0);
  vec4 h = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 origin = h.xyz / h.w + N * 0.014;
  vec3 direction = normalize(uLightDir);

  float rodT = cylinderHit(origin, direction);
  float wallT = boxHit(origin, direction);
  float nearest = min(rodT, wallT);
  bool occluded = nearest <= uRayLength;
  int kind = rodT <= wallT ? 1 : 2;
  outReference = vec4(
    occluded ? 0.0 : 1.0,
    occluded ? float(kind) / 255.0 : 0.0,
    occluded ? clamp(nearest / uRayLength, 0.0, 1.0) : 0.0,
    occluded ? 1.0 : 0.0
  );
}
`;
