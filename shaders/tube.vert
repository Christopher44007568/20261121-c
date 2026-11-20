#version 430 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;

out vec3 vWorldPosition;
out vec3 vWorldNormal;
out vec3 vViewDirection;

void main() {
    vWorldPosition = aPosition;
    vWorldNormal = aNormal;
    vViewDirection = normalize(uCameraPosition - aPosition);
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
