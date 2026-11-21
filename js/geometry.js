export const EPSILON = 1e-10;

export function multiplyMat3(a, b) {
  const out = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) {
        out[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
      }
    }
  }
  return out;
}

export function invertMat3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < EPSILON) {
    throw new Error("Homography is singular");
  }
  const inv = 1 / det;
  return [
    A * inv, B * inv, C * inv,
    D * inv, E * inv, F * inv,
    G * inv, H * inv, I * inv,
  ];
}

export function applyHomography(matrix, point) {
  const x = point.x ?? point[0];
  const y = point.y ?? point[1];
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(w) < EPSILON) return { x: NaN, y: NaN, w };
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / w,
    w,
  };
}

export function matrixFromQuad(corners) {
  const source = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const target = corners.map((point) => (
    Array.isArray(point) ? { x: point[0], y: point[1] } : point
  ));
  return fitHomography(source, target).matrix;
}

function normalizePoints(points) {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= n;
  cy /= n;
  let meanDistance = 0;
  for (const point of points) {
    meanDistance += Math.hypot(point.x - cx, point.y - cy);
  }
  meanDistance /= n;
  const scale = meanDistance < EPSILON ? 1 : Math.SQRT2 / meanDistance;
  const matrix = [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1];
  const normalized = points.map((point) => ({
    x: scale * (point.x - cx),
    y: scale * (point.y - cy),
  }));
  return { matrix, points: normalized };
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Control points are degenerate");
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k <= n; k += 1) {
        a[row][k] -= factor * a[col][k];
      }
    }
  }
  return a.map((row) => row[n]);
}

export function fitHomography(sourcePoints, targetPoints) {
  if (sourcePoints.length < 4 || sourcePoints.length !== targetPoints.length) {
    throw new Error("At least four point pairs are required");
  }
  const srcNorm = normalizePoints(sourcePoints);
  const dstNorm = normalizePoints(targetPoints);
  const normal = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const rhs = new Array(8).fill(0);

  for (let index = 0; index < srcNorm.points.length; index += 1) {
    const { x, y } = srcNorm.points[index];
    const X = dstNorm.points[index].x;
    const Y = dstNorm.points[index].y;
    const rows = [
      { coeff: [-x, -y, -1, 0, 0, 0, x * X, y * X], value: -X },
      { coeff: [0, 0, 0, -x, -y, -1, x * Y, y * Y], value: -Y },
    ];
    for (const row of rows) {
      for (let i = 0; i < 8; i += 1) {
        rhs[i] += row.coeff[i] * row.value;
        for (let j = 0; j < 8; j += 1) {
          normal[i][j] += row.coeff[i] * row.coeff[j];
        }
      }
    }
  }

  const solution = solveLinearSystem(normal, rhs);
  const normalizedMatrix = [...solution, 1];
  const matrix = multiplyMat3(
    invertMat3(dstNorm.matrix),
    multiplyMat3(normalizedMatrix, srcNorm.matrix),
  );
  const scale = matrix[8] || 1;
  const normalized = matrix.map((value) => value / scale);
  const residuals = sourcePoints.map((source, index) => {
    const mapped = applyHomography(normalized, source);
    return Math.hypot(mapped.x - targetPoints[index].x, mapped.y - targetPoints[index].y);
  });
  const rms = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );
  return {
    matrix: normalized,
    residuals,
    rms,
    max: Math.max(...residuals),
  };
}

export function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function edgeFeather(u, width) {
  const w = Math.min(0.48, Math.max(0.0001, width));
  return smoothstep(0, w, u) * smoothstep(0, w, 1 - u);
}

export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

export function solveBlendLuminance(channels, point, targetLinear = srgbToLinear(0.5)) {
  let numerator = 0;
  let denominator = 0;
  for (const channel of channels) {
    if (!channel.enabled) continue;
    const uv = applyHomography(channel.inverse, point);
    if (uv.w <= 0 || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) continue;
    const weight = edgeFeather(uv.x, channel.feather);
    numerator += targetLinear * channel.gain * weight;
    denominator += weight;
  }
  if (denominator <= EPSILON) return { luminance: 0, covered: false };
  return { luminance: numerator / denominator, covered: true };
}
