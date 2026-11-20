#version 450

layout(location = 0) in vec3 inPos;
layout(location = 1) in float inPlateId;

layout(push_constant) uniform Push {
  mat4 mvp;       // proj * view * model
  mat4 modelView; // view * model, for view-space depth
} pc;

layout(location = 0) out float viewDepth; // positive distance along view axis
layout(location = 1) flat out float plateId;

void main() {
  vec4 viewPos = pc.modelView * vec4(inPos, 1.0);
  viewDepth = -viewPos.z;
  plateId = inPlateId;
  gl_Position = pc.mvp * vec4(inPos, 1.0);
}
