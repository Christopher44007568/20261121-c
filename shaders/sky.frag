#version 450 core

in vec2 vNdc;
uniform vec2 uResolution;
out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec3 bottom = vec3(0.032, 0.047, 0.063);
    vec3 horizon = vec3(0.075, 0.100, 0.125);
    vec3 top = vec3(0.012, 0.022, 0.038);
    vec3 color = mix(bottom, horizon, smoothstep(0.0, 0.50, uv.y));
    color = mix(color, top, smoothstep(0.48, 1.0, uv.y));
    float vignette = 1.0 - 0.20 * length(uv - vec2(0.5, 0.55));
    fragColor = vec4(color * vignette, 1.0);
}

