#version 330 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 uMvp;
uniform mat4 uView;
uniform float uPointSize;
uniform float uViewportHeight;
uniform float uAlpha;

out vec4 vColor;

void main() {
    vec4 eye = uView * vec4(aPosition, 1.0);
    gl_Position = uMvp * vec4(aPosition, 1.0);
    float perspective = uViewportHeight * 0.0035 / max(2.0, -eye.z);
    gl_PointSize = clamp(uPointSize * perspective, 1.0, 12.0);
    vColor = vec4(aColor.rgb, aColor.a * uAlpha);
}
