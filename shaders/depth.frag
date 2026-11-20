#version 450

layout(location = 0) in float viewDepth;
layout(location = 1) flat in float plateId;
layout(location = 0) out float outLinearDepth;
layout(location = 1) out float outPlateId;

void main() {
  // Perspective-correct interpolation of view-space z is exact for planar
  // geometry, so this is a true linear (view-axis) depth map.
  outLinearDepth = viewDepth;
  outPlateId = plateId;
}
