import {
  depthFromPoint,
  mat4,
  projectionOffsetDepth,
  transformPoint,
  vec3
} from "./math.js";
import { edgeMidpoint, interpolateEdge } from "./geometry.js";

const TRIANGLE_EPSILON = 1e-10;

export function createAnalyzer(solid, config) {
  return {
    solid,
    config,
    analyze(pose, settings) {
      return analyzePose(solid, config, pose, settings);
    }
  };
}

export function analyzePose(solid, config, pose, settings) {
  const view = mat4.lookAt(pose.eye, pose.target, pose.up);
  const projection = mat4.perspective(
    config.fovY,
    settings.aspect || 16 / 9,
    config.near,
    config.far
  );
  const viewProjection = mat4.multiply(projection, view);
  const tolerance = settings.tolerance;
  const offset = settings.offset;
  const counts = emptyCounts();
  const gates = new Map();

  for (const edge of solid.edges) {
    const length = vec3.length(vec3.sub(edge.b, edge.a));
    const sampleCount = Math.max(3, Math.min(9, Math.ceil(length / 0.35)));
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const t = (sampleIndex + 0.5) / sampleCount;
      evaluateSample({
        solid,
        config,
        pose,
        view,
        viewProjection,
        tolerance,
        offset,
        edge,
        point: interpolateEdge(edge, t),
        counts,
        gates
      });
    }
  }

  counts.offsetFar = farLimit(gates, "offset", config);
  counts.depthFar = farLimit(gates, "depth", config);
  counts.offsetFarInView = [...gates.values()].some((gate) => gate.reference > 0);
  counts.depthFarInView = counts.offsetFarInView;
  counts.averageEdgeDistance = averageDistance(solid, pose.eye);
  counts.sampleCount = counts.total;
  counts.offsetCoplanarRate = safeRate(counts.offsetCoplanarPass, counts.coplanarTotal);
  counts.depthCoplanarRate = safeRate(counts.depthCoplanarPass, counts.coplanarTotal);
  counts.offsetExternalLeakRate = safeRate(counts.offsetExternalLeak, counts.externalHidden);
  counts.depthExternalLeakRate = safeRate(counts.depthExternalLeak, counts.externalHidden);
  return counts;
}

function evaluateSample(context) {
  const {
    pose,
    viewProjection,
    tolerance,
    offset,
    edge,
    point,
    counts,
    gates
  } = context;

  const projected = projectSample(viewProjection, point);
  if (!projected.inView) return;

  const ray = vec3.normalize(vec3.sub(point, pose.eye));
  const pointDistance = vec3.length(vec3.sub(point, pose.eye));
  const referenceEpsilon = Math.max(1e-5, pointDistance * 1.5e-6);
  const hit = nearestHit(context.solid.triangles, pose.eye, ray, pointDistance + referenceEpsilon);
  const sceneDistance = hit ? hit.distance : Infinity;
  const sceneDepth = hit ? depthFromPoint(viewProjection, hit.point) : 1;
  const referenceVisible = sceneDistance >= pointDistance - referenceEpsilon;
  const edgeDepth = projected.depth;

  const offsetDepth = projectionOffsetDepth(
    pose.eye,
    point,
    offset,
    context.config.near,
    context.config.far,
    context.view
  );
  const depthLevels = 2 ** context.config.depthBits - 1;
  const offsetMargin = (sceneDepth - offsetDepth) * depthLevels;
  const offsetVisible = hit ? offsetMargin >= 1.5 : offsetDepth < 1;
  const depthVisible = hit
    ? edgeDepth <= sceneDepth + tolerance
    : edgeDepth <= 1 + tolerance;

  counts.total += 1;
  if (referenceVisible) counts.referenceVisible += 1;
  if (offsetVisible) counts.offsetVisible += 1;
  if (depthVisible) counts.depthVisible += 1;
  if (referenceVisible && !offsetVisible) counts.offsetMissed += 1;
  if (referenceVisible && !depthVisible) counts.depthMissed += 1;
  if (!referenceVisible && offsetVisible) counts.offsetBleed += 1;
  if (!referenceVisible && depthVisible) counts.depthBleed += 1;

  if (edge.thinBack) {
    counts.thinBackTotal += 1;
    if (!referenceVisible) counts.thinBackHidden += 1;
    if (!referenceVisible && offsetVisible) counts.offsetThinLeak += 1;
    if (!referenceVisible && depthVisible) counts.depthThinLeak += 1;
  }

  const gateIndex = edge.metadata && edge.metadata.gateIndex;
  const isFarEdge = Number.isInteger(gateIndex);
  if (edge.kind === "coplanar" && referenceVisible && !isFarEdge) {
    counts.coplanarTotal += 1;
    if (offsetVisible) counts.offsetCoplanarPass += 1;
    if (depthVisible) counts.depthCoplanarPass += 1;
  }

  const externallyOccluded = Boolean(
    hit && !referenceVisible && hit.part !== edge.part && !isFarEdge
  );
  if (externallyOccluded) {
    counts.externalHidden += 1;
    if (offsetVisible) counts.offsetExternalLeak += 1;
    if (depthVisible) counts.depthExternalLeak += 1;
  }

  if (Number.isInteger(gateIndex) && referenceVisible) {
    if (!gates.has(gateIndex)) {
      gates.set(gateIndex, {
        distance: edge.metadata.gateDistance,
        reference: 0,
        offset: 0,
        depth: 0
      });
    }
    const gate = gates.get(gateIndex);
    gate.reference += 1;
    if (offsetVisible) gate.offset += 1;
    if (depthVisible) gate.depth += 1;
  }

}

function projectSample(viewProjection, point) {
  const clip = transformPoint(viewProjection, point);
  if (clip[3] <= 1e-8) return { inView: false, depth: 1 };
  const invW = 1 / clip[3];
  const x = clip[0] * invW;
  const y = clip[1] * invW;
  const z = clip[2] * invW;
  const inView = x >= -1.08 && x <= 1.08 && y >= -1.08 && y <= 1.08 && z >= -1 && z <= 1;
  return { inView, x, y, depth: z * 0.5 + 0.5 };
}

function nearestHit(triangles, origin, direction, maxDistance) {
  let nearest = Infinity;
  let nearestPart = null;
  for (const triangle of triangles) {
    const distance = rayTriangle(origin, direction, triangle.a, triangle.b, triangle.c);
    if (distance > 1e-7 && distance < nearest && distance <= maxDistance) {
      nearest = distance;
      nearestPart = triangle.part;
    }
  }
  if (!Number.isFinite(nearest)) return null;
  return {
    distance: nearest,
    part: nearestPart,
    point: vec3.add(origin, vec3.scale(direction, nearest))
  };
}

function rayTriangle(origin, direction, a, b, c) {
  const edge1 = vec3.sub(b, a);
  const edge2 = vec3.sub(c, a);
  const h = vec3.cross(direction, edge2);
  const determinant = vec3.dot(edge1, h);
  if (Math.abs(determinant) < TRIANGLE_EPSILON) return Infinity;
  const invDeterminant = 1 / determinant;
  const s = vec3.sub(origin, a);
  const u = invDeterminant * vec3.dot(s, h);
  if (u < 0 || u > 1) return Infinity;
  const q = vec3.cross(s, edge1);
  const v = invDeterminant * vec3.dot(direction, q);
  if (v < 0 || u + v > 1) return Infinity;
  return invDeterminant * vec3.dot(edge2, q);
}

function farLimit(gates, method, config) {
  const sorted = [...gates.values()].sort((a, b) => a.distance - b.distance);
  for (const gate of sorted) {
    if (gate.reference <= 0) continue;
    if (gate[method] / gate.reference < 0.5) return gate.distance;
  }
  return Infinity;
}

function averageDistance(solid, eye) {
  if (solid.edges.length === 0) return 0;
  let total = 0;
  for (const edge of solid.edges) {
    const midpoint = edgeMidpoint(edge);
    total += vec3.length(vec3.sub(midpoint, eye));
  }
  return total / solid.edges.length;
}

function emptyCounts() {
  return {
    total: 0,
    sampleCount: 0,
    referenceVisible: 0,
    offsetVisible: 0,
    depthVisible: 0,
    offsetMissed: 0,
    depthMissed: 0,
    offsetBleed: 0,
    depthBleed: 0,
    thinBackTotal: 0,
    thinBackHidden: 0,
    offsetThinLeak: 0,
    depthThinLeak: 0,
    coplanarTotal: 0,
    offsetCoplanarPass: 0,
    depthCoplanarPass: 0,
    offsetCoplanarRate: 0,
    depthCoplanarRate: 0,
    externalHidden: 0,
    offsetExternalLeak: 0,
    depthExternalLeak: 0,
    offsetExternalLeakRate: 0,
    depthExternalLeakRate: 0,
    offsetFar: Infinity,
    depthFar: Infinity,
    offsetFarInView: false,
    depthFarInView: false,
    averageEdgeDistance: 0
  };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
