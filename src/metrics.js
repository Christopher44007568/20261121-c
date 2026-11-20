function subtract(a, b, offsetA = 0, offsetB = 0) {
  return [
    a[offsetA] - b[offsetB],
    a[offsetA + 1] - b[offsetB + 1],
    a[offsetA + 2] - b[offsetB + 2],
  ];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (length < 1e-12) return null;
  return vector.map((value) => value / length);
}

export function polygonArea3D(points) {
  const count = points.length / 3;
  if (count < 3) return 0;
  const centroid = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    centroid[0] += points[index * 3];
    centroid[1] += points[index * 3 + 1];
    centroid[2] += points[index * 3 + 2];
  }
  centroid[0] /= count;
  centroid[1] /= count;
  centroid[2] /= count;

  const normal = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const a = subtract(points, centroid, index * 3);
    const b = subtract(points, centroid, next * 3);
    const faceNormal = cross(a, b);
    normal[0] += faceNormal[0];
    normal[1] += faceNormal[1];
    normal[2] += faceNormal[2];
  }

  const planeNormal = normalize(normal);
  if (!planeNormal) return 0;
  let axisU = null;
  for (let index = 0; index < count && !axisU; index += 1) {
    axisU = normalize(subtract(points, centroid, index * 3));
  }
  if (!axisU) return 0;
  const axisV = normalize(cross(planeNormal, axisU));
  if (!axisV) return 0;

  let twiceArea = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const a = subtract(points, centroid, index * 3);
    const b = subtract(points, centroid, next * 3);
    twiceArea += dot(a, axisU) * dot(b, axisV) - dot(b, axisU) * dot(a, axisV);
  }
  return Math.abs(twiceArea) * 0.5;
}

export function ringPoints(positions, start, segments) {
  const points = new Float32Array(segments * 3);
  points.set(positions.subarray(start * 3, (start + segments) * 3));
  return points;
}

export function ringArea(positions, start, segments, unitScale = 10) {
  return polygonArea3D(ringPoints(positions, start, segments)) * unitScale * unitScale;
}

export function buildContinuityEdges(ringStarts, segments) {
  const edges = [];
  for (let ring = 0; ring < ringStarts.length; ring += 1) {
    const start = ringStarts[ring];
    for (let segment = 0; segment < segments; segment += 1) {
      edges.push(start + segment, start + ((segment + 1) % segments));
    }
    if (ring < ringStarts.length - 1) {
      const next = ringStarts[ring + 1];
      for (let segment = 0; segment < segments; segment += 1) {
        edges.push(start + segment, next + segment);
      }
    }
  }
  return new Uint32Array(edges);
}

function distance(positions, a, b) {
  const aOffset = a * 3;
  const bOffset = b * 3;
  return Math.hypot(
    positions[aOffset] - positions[bOffset],
    positions[aOffset + 1] - positions[bOffset + 1],
    positions[aOffset + 2] - positions[bOffset + 2],
  );
}

export function continuityMetrics(bindPositions, deformedPositions, edges) {
  const strains = [];
  let max = 0;
  let overFivePercent = 0;
  for (let index = 0; index < edges.length; index += 2) {
    const a = edges[index];
    const b = edges[index + 1];
    const bindLength = distance(bindPositions, a, b);
    if (bindLength < 1e-7) continue;
    const strain = Math.abs(distance(deformedPositions, a, b) / bindLength - 1);
    strains.push(strain);
    max = Math.max(max, strain);
    overFivePercent += strain > 0.05 ? 1 : 0;
  }
  strains.sort((a, b) => a - b);
  const percentile = (value) => {
    if (!strains.length) return 0;
    return strains[Math.min(strains.length - 1, Math.floor((strains.length - 1) * value))];
  };
  return {
    max,
    p95: percentile(0.95),
    median: percentile(0.5),
    overFivePercent,
    count: strains.length,
  };
}

export function measurePose({
  bindPositions,
  lbsPositions,
  dqPositions,
  meta,
  animation,
  edges,
}) {
  const sliceIndices = meta.slices[animation];
  const rings = sliceIndices.map((ring) => {
    const start = meta.ringStarts[ring];
    return {
      ring,
      x: meta.stationX[ring],
      bind: ringArea(bindPositions, start, meta.segments),
      lbs: ringArea(lbsPositions, start, meta.segments),
      dq: ringArea(dqPositions, start, meta.segments),
    };
  });
  const primaryRing = sliceIndices[Math.floor(sliceIndices.length / 2)];
  const primary =
    rings.find((ring) => ring.ring === primaryRing) ?? rings[0];
  const mean = (key) => rings.reduce((sum, ring) => sum + ring[key], 0) / rings.length;

  return {
    rings,
    primary,
    bindMean: mean("bind"),
    lbsMean: mean("lbs"),
    dqMean: mean("dq"),
    lbsContinuity: continuityMetrics(bindPositions, lbsPositions, edges),
    dqContinuity: continuityMetrics(bindPositions, dqPositions, edges),
  };
}
