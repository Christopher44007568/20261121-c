#version 460

layout(location = 0) in vec3 inPos;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in vec2 inUV;
layout(location = 3) in vec4 inTangent;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 lightDir;
    vec4 cameraPos;
    vec4 params;
    vec4 tint;
    vec4 seamX;
} pc;

layout(location = 0) out vec3 vWorldPos;
layout(location = 1) out vec3 vNormal;
layout(location = 2) out vec2 vUV;
layout(location = 3) out vec4 vTangent;

void main() {
    vWorldPos = inPos;
    vNormal = normalize(inNormal);
    vTangent = vec4(normalize(inTangent.xyz), inTangent.w);
    vUV = inUV;
    gl_Position = pc.viewProj * vec4(inPos, 1.0);
}
