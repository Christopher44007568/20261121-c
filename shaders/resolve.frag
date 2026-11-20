#version 430 core

in vec2 vUV;
layout(location = 0) out vec4 outColor;

uniform sampler2D uAccumulation;
uniform sampler2D uRevealage;
uniform vec2 uResolution;

vec3 background(vec2 uv) {
    float horizon = smoothstep(0.0, 1.0, uv.y);
    vec3 low = vec3(0.012, 0.020, 0.034);
    vec3 high = vec3(0.045, 0.070, 0.105);
    vec3 color = mix(low, high, horizon);
    vec2 d = uv - vec2(0.5, 0.44);
    color += vec3(0.020, 0.045, 0.060) * exp(-5.5 * dot(d, d));
    float grid = step(0.985, fract(uv.x * 24.0)) + step(0.985, fract(uv.y * 16.0));
    return color - grid * 0.006;
}

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec4 accum = texture(uAccumulation, uv);
    float reveal = texture(uRevealage, uv).r;
    vec3 transparentColor = accum.a > 1.0e-6 ? accum.rgb / accum.a : vec3(0.0);
    float coverage = 1.0 - reveal;
    vec3 color = mix(background(uv), transparentColor, coverage);
    outColor = vec4(color, 1.0);
}
