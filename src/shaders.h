#pragma once

inline const char *kVertShader = R"GLSL(
#version 330 core
void main() {
  // Fullscreen triangle from gl_VertexID.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)GLSL";

inline const char *kFragShader = R"GLSL(
#version 330 core
out vec4 fragColor;

uniform sampler3D volTex;
uniform sampler2D tfLut;      // 1D LUT (res x 1): rgb = color, a = sigma
uniform sampler2D preintLut;  // 2D LUT (s_front, s_back): rgb = C, a = T
uniform vec3 eye, camRight, camUp, camForward;
uniform vec2 halfSize;
uniform vec2 resolution;
uniform float stepSize;
uniform int mode;      // 0 = post-classified, 1 = pre-integrated
uniform int jitterOn;
uniform int frameSeed;

vec2 boxIntersect(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 a = (vec3(0.0) - ro) * inv;
  vec3 b = (vec3(1.0) - ro) * inv;
  vec3 tmin = min(a, b), tmax = max(a, b);
  return vec2(max(max(tmin.x, tmin.y), tmin.z),
              min(min(tmax.x, tmax.y), tmax.z));
}

uint pcg(uint v) {
  v = v * 747796405u + 2891336453u;
  uint s = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (s >> 22u) ^ s;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;
  vec3 ro = eye + camRight * (ndc.x * halfSize.x) + camUp * (ndc.y * halfSize.y);
  vec3 rd = camForward;
  vec2 t = boxIntersect(ro, rd);
  if (t.x >= t.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  t.x = max(t.x, 0.0);

  // Stochastic jitter of the first sample in [0, stepSize): decorrelates
  // the sampling lattice from the view direction (kills wood-grain
  // stripes when the volume is rotated relative to the image plane).
  float jitter = 0.0;
  if (jitterOn != 0) {
    uint h = pcg(uint(gl_FragCoord.x) ^
                 pcg(uint(gl_FragCoord.y) ^ pcg(uint(frameSeed))));
    jitter = float(h & 0xFFFFFFu) / 16777216.0;
  }

  float ti = t.x + jitter * stepSize;
  vec3 C = vec3(0.0);
  float T = 1.0;
  float sPrev = texture(volTex, ro + rd * ti).r;
  for (int iter = 0; iter < 4096 && ti < t.y && T > 1e-5; ++iter) {
    float tn = min(ti + stepSize, t.y);
    float segLen = tn - ti;
    float sCur = texture(volTex, ro + rd * tn).r;
    vec3 cSeg;
    float tSeg;
    if (mode == 1) {
      // Pre-integrated segment (LUT built for stepSize). Partial tail
      // segments rescale: optical depth is linear in length, emission
      // approximately so.
      vec4 lut = texture(preintLut, vec2(sPrev, sCur));
      float f = segLen / stepSize;
      tSeg = pow(max(lut.a, 1e-12), f);
      cSeg = lut.rgb * f;
    } else {
      // Classic post-classified sampling at the segment back point.
      vec4 tf = texture(tfLut, vec2(sCur, 0.5));
      float sigma = tf.a;
      tSeg = exp(-sigma * segLen);
      float w = sigma > 1e-6 ? (1.0 - tSeg) / sigma : segLen;
      cSeg = tf.rgb * w;
    }
    C += T * cSeg;
    T *= tSeg;
    sPrev = sCur;
    ti = tn;
  }
  fragColor = vec4(C, T);
}
)GLSL";
