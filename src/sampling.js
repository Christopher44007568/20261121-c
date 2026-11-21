import {
  buildFrame,
  clamp,
  dot,
  hammersley,
  hash2,
  normalize
} from "./math.js";

export function cosineHemisphere(u, v, directionality = 1) {
  const cosineZ = Math.sqrt(1 - v);
  const z = cosineZ + (v - cosineZ) * (1 - clamp(directionality, 0, 1));
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = 2 * Math.PI * u;
  return [Math.cos(phi) * radial, Math.sin(phi) * radial, z];
}

export function buildSampleDirections(normal, count, seed, directionality = 1) {
  const [tangent, bitangent, n] = buildFrame(normal);
  const rotate = hash2(Math.round(normal[0] * 1e5), Math.round(normal[2] * 1e5), seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [u0, u1] = hammersley(i, count);
    const u = (u0 + rotate) % 1;
    const local = cosineHemisphere(u, u1, directionality);
    const dir = normalize([
      tangent[0] * local[0] + bitangent[0] * local[1] + n[0] * local[2],
      tangent[1] * local[0] + bitangent[1] * local[1] + n[1] * local[2],
      tangent[2] * local[0] + bitangent[2] * local[1] + n[2] * local[2]
    ]);
    out[i * 3] = dir[0];
    out[i * 3 + 1] = dir[1];
    out[i * 3 + 2] = dir[2];
  }
  return out;
}

export function sampleWeight(direction, normal) {
  return Math.max(0, dot(direction, normal));
}
