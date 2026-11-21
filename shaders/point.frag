#version 330 core

in vec4 vColor;

uniform vec3 uNodeTint;
uniform float uNodeTintMix;

out vec4 fragColor;

void main() {
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    if (dot(centered, centered) > 1.0) {
        discard;
    }
    vec3 color = mix(vColor.rgb, uNodeTint, uNodeTintMix);
    fragColor = vec4(color, vColor.a);
}
