export const compositeFS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uDepth;
uniform sampler2D uTrace;
uniform sampler2D uReference;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform vec3 uLightDir;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform int uViewMode;
out vec4 outColor;

vec3 sky(vec2 uv) {
  float horizon = smoothstep(0.18, 0.85, uv.y);
  vec3 top = vec3(0.007, 0.012, 0.016);
  vec3 low = vec3(0.022, 0.032, 0.038);
  vec3 c = mix(low, top, horizon);
  c += pow(max(0.0, uv.x - 0.56), 10.0) * vec3(0.018, 0.024, 0.024);
  return c;
}

float shadowVisibility(vec2 uv) {
  vec2 texel = 1.0 / uResolution;
  float v = texture(uTrace, uv).a * 0.40;
  v += texture(uTrace, uv + vec2(texel.x, 0.0)).a * 0.15;
  v += texture(uTrace, uv - vec2(texel.x, 0.0)).a * 0.15;
  v += texture(uTrace, uv + vec2(0.0, texel.y)).a * 0.15;
  v += texture(uTrace, uv - vec2(0.0, texel.y)).a * 0.15;
  return clamp(v, 0.0, 1.0);
}

vec3 beauty(vec3 world, vec3 N, vec3 albedo, float visibility) {
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uCameraPos - world);
  vec3 H = normalize(L + V);
  float diffuse = max(dot(N, L), 0.0);
  float specular = pow(max(dot(N, H), 0.0), 54.0) * 0.05;
  float skyAmount = N.y * 0.5 + 0.5;
  vec3 ambient = mix(vec3(0.045, 0.052, 0.06), vec3(0.23, 0.255, 0.26), skyAmount);
  vec3 direct = vec3(1.28, 1.18, 1.02) * diffuse * visibility;
  vec3 color = albedo * (ambient + direct) + specular * visibility;

  float distanceToCamera = length(uCameraPos - world);
  float haze = smoothstep(18.0, 52.0, distanceToCamera);
  color = mix(color, vec3(0.018, 0.026, 0.03), haze * 0.72);
  color *= 1.0 - 0.15 * smoothstep(0.62, 1.0, length((gl_FragCoord.xy / uResolution - 0.5) * vec2(1.1, 1.0)));
  return pow(max(color, 0.0), vec3(1.0 / 2.2));
}

vec3 traceMode(float steps, int basis) {
  float t = clamp(steps / 56.0, 0.0, 1.0);
  vec3 c = mix(vec3(0.012, 0.055, 0.15), vec3(0.02, 0.32, 0.78), smoothstep(0.0, 0.62, t));
  c = mix(c, vec3(0.24, 0.77, 1.0), smoothstep(0.58, 0.92, t));
  c = mix(c, vec3(0.88, 0.97, 1.0), smoothstep(0.91, 1.0, t));
  if (basis == 1) c += vec3(0.03, 0.12, 0.08);
  return c;
}

vec3 basisMode(int basis) {
  if (basis == 1) return vec3(0.13, 0.78, 0.49);
  if (basis == 2) return vec3(0.25, 0.55, 1.0);
  if (basis == 3) return vec3(1.0, 0.56, 0.13);
  return vec3(0.86, 0.89, 0.89);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float depth = texture(uDepth, uv).r;
  if (depth <= 0.000001) {
    outColor = vec4(sky(uv), 1.0);
    return;
  }

  vec3 albedo = texture(uAlbedo, uv).rgb;
  vec3 N = normalize(texture(uNormal, uv).xyz * 2.0 - 1.0);
  vec4 h = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = h.xyz / h.w;
  vec4 traceSample = texture(uTrace, uv);
  float steps = floor(traceSample.r * 63.0 + 0.5);
  int packed = int(floor(traceSample.g * 255.0 + 0.5));
  int basis = packed % 8;

  vec3 beautyColor = beauty(world, N, albedo, shadowVisibility(uv));
  float traceLit = texture(uTrace, uv).a;
  vec3 shadowColor = mix(vec3(0.025, 0.028, 0.029), vec3(0.82, 0.86, 0.87), traceLit);
  float refLit = texture(uReference, uv).r;
  vec3 refColor = mix(vec3(0.025, 0.028, 0.029), vec3(0.82, 0.86, 0.87), refLit);

  if (uViewMode == 0) {
    outColor = vec4(beautyColor, 1.0);
  } else if (uViewMode == 1) {
    outColor = vec4(shadowColor, 1.0);
  } else if (uViewMode == 2) {
    outColor = vec4(traceMode(steps, basis), 1.0);
  } else if (uViewMode == 3) {
    outColor = vec4(basisMode(basis), 1.0);
  } else if (uViewMode == 4) {
    outColor = vec4(refColor, 1.0);
  } else {
    outColor = vec4(gl_FragCoord.x < uResolution.x * 0.5 ? shadowColor : refColor, 1.0);
  }
}
`;
