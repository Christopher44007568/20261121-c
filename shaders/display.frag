#version 430 core

in vec2 vUV;
layout(location = 0) out vec4 outColor;

uniform sampler2D uWboit;
uniform sampler2D uReference;
uniform sampler2D uError;
uniform vec2 uResolution;
uniform int uMode;
uniform float uErrorGain;

vec3 heat(float value) {
    float v = clamp(value, 0.0, 1.0);
    vec3 navy = vec3(0.015, 0.025, 0.110);
    vec3 blue = vec3(0.050, 0.320, 0.760);
    vec3 cyan = vec3(0.020, 0.850, 0.850);
    vec3 yellow = vec3(0.980, 0.830, 0.070);
    vec3 red = vec3(0.950, 0.130, 0.040);
    if (v < 0.25) return mix(navy, blue, v / 0.25);
    if (v < 0.50) return mix(blue, cyan, (v - 0.25) / 0.25);
    if (v < 0.75) return mix(cyan, yellow, (v - 0.50) / 0.25);
    return mix(yellow, red, (v - 0.75) / 0.25);
}

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    if (uMode == 0) {
        outColor = vec4(texture(uWboit, uv).rgb, 1.0);
    } else if (uMode == 1) {
        outColor = vec4(texture(uReference, uv).rgb, 1.0);
    } else if (uMode == 2) {
        float error = texture(uError, uv).r * uErrorGain;
        outColor = vec4(heat(error), 1.0);
    } else {
        float panel = floor(uv.x * 3.0);
        float localX = fract(uv.x * 3.0);
        vec2 panelUV = vec2(localX, uv.y);
        vec3 color;
        if (panel < 1.0) {
            color = texture(uWboit, panelUV).rgb;
        } else if (panel < 2.0) {
            color = texture(uReference, panelUV).rgb;
        } else {
            float error = texture(uError, panelUV).r * uErrorGain;
            color = heat(error);
        }
        float separator = 1.0 - smoothstep(0.0, 0.003, min(localX, 1.0 - localX));
        color = mix(color, vec3(0.72, 0.78, 0.82), separator * 0.7);
        outColor = vec4(color, 1.0);
    }
}
