export const LBS = "lbs";
export const DQ = "dq";

export function quatDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function quatNormalize(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((value) => value / length);
}

export function quatFromAxisAngle(axis, radians) {
  const half = radians / 2;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

export function rotateByQuat(vector, q) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function shortestNlerp(a, b, t) {
  const sign = quatDot(a, b) < 0 ? -1 : 1;
  return quatNormalize(a.map((value, index) => value * (1 - t) + b[index] * sign * t));
}

export function quatAngle(q) {
  const normalized = quatNormalize(q);
  return 2 * Math.acos(Math.min(1, Math.abs(normalized[3])));
}

export function dqFromRigid(rotation, translation) {
  const [rx, ry, rz, rw] = rotation;
  const [tx, ty, tz] = translation;
  return {
    real: [rx, ry, rz, rw],
    dual: [
      0.5 * (tx * rw + ty * rz - tz * ry),
      0.5 * (-tx * rz + ty * rw + tz * rx),
      0.5 * (tx * ry - ty * rx + tz * rw),
      -0.5 * (tx * rx + ty * ry + tz * rz),
    ],
  };
}

function dqTranslation(real, dual) {
  const [rx, ry, rz, rw] = real;
  const [dx, dy, dz, dw] = dual;
  return [
    2 * (dw * -rx + dx * rw + dy * -rz - dz * -ry),
    2 * (dw * -ry - dx * -rz + dy * rw + dz * -rx),
    2 * (dw * -rz + dx * -ry - dy * -rx + dz * rw),
  ];
}

export function blendDualQuaternions(influences) {
  if (!influences.length) return null;
  const pivot = influences[0].dq.real;
  const real = [0, 0, 0, 0];
  const dual = [0, 0, 0, 0];
  let flipped = 0;

  for (const { dq, weight } of influences) {
    const sign = quatDot(pivot, dq.real) < 0 ? -1 : 1;
    if (sign < 0) flipped += 1;
    for (let index = 0; index < 4; index += 1) {
      real[index] += dq.real[index] * weight * sign;
      dual[index] += dq.dual[index] * weight * sign;
    }
  }

  const length = Math.hypot(...real) || 1;
  for (let index = 0; index < 4; index += 1) {
    real[index] /= length;
    dual[index] /= length;
  }

  return {
    real,
    dual,
    translation: dqTranslation(real, dual),
    flipped,
  };
}

export function normalizeSkinWeights(rawJoints, rawWeights, epsilon = 1e-8) {
  const entries = [];
  let rawSum = 0;
  let dropped = 0;

  for (let index = 0; index < rawWeights.length; index += 1) {
    const weight = Number(rawWeights[index]);
    const joint = Number(rawJoints[index]);
    if (!Number.isFinite(weight) || weight <= epsilon) {
      dropped += 1;
      continue;
    }
    rawSum += weight;
    entries.push({ joint, weight });
  }

  if (rawSum <= epsilon) {
    return {
      joints: [0, 0, 0, 0],
      weights: [1, 0, 0, 0],
      rawSum: 0,
      dropped,
      fallback: true,
    };
  }

  return {
    joints: entries.map((entry) => entry.joint),
    weights: entries.map((entry) => entry.weight / rawSum),
    rawSum,
    dropped,
    fallback: false,
  };
}

function transpose3(matrix) {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

function determinant3(matrix) {
  return (
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
  );
}

function inverse3(matrix) {
  const determinant = determinant3(matrix);
  if (Math.abs(determinant) < 1e-12) return null;
  const scale = 1 / determinant;
  return [
    (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * scale,
    (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * scale,
    (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * scale,
    (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * scale,
    (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * scale,
    (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * scale,
    (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * scale,
    (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * scale,
    (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * scale,
  ];
}

function multiply3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function polarDecompose3(matrix, iterations = 9) {
  let rotation = matrix.slice();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const inverseTranspose = inverse3(transpose3(rotation));
    if (!inverseTranspose) break;
    rotation = rotation.map((value, index) => 0.5 * (value + inverseTranspose[index]));
  }
  const symmetric = multiply3(transpose3(rotation), matrix);
  return { rotation, symmetric };
}

export function quatFromMatrix3(matrix) {
  const trace = matrix[0] + matrix[4] + matrix[8];
  if (trace > 0) {
    const scale = 0.5 / Math.sqrt(trace + 1);
    return [
      (matrix[7] - matrix[5]) * scale,
      (matrix[2] - matrix[6]) * scale,
      (matrix[3] - matrix[1]) * scale,
      0.25 / scale,
    ];
  }
  if (matrix[0] > matrix[4] && matrix[0] > matrix[8]) {
    const scale = 2 * Math.sqrt(1 + matrix[0] - matrix[4] - matrix[8]);
    return [
      0.25 * scale,
      (matrix[1] + matrix[3]) / scale,
      (matrix[2] + matrix[6]) / scale,
      (matrix[7] - matrix[5]) / scale,
    ];
  }
  if (matrix[4] > matrix[8]) {
    const scale = 2 * Math.sqrt(1 + matrix[4] - matrix[0] - matrix[8]);
    return [
      (matrix[1] + matrix[3]) / scale,
      0.25 * scale,
      (matrix[5] + matrix[7]) / scale,
      (matrix[2] - matrix[6]) / scale,
    ];
  }
  const scale = 2 * Math.sqrt(1 + matrix[8] - matrix[0] - matrix[4]);
  return [
    (matrix[2] + matrix[6]) / scale,
    (matrix[5] + matrix[7]) / scale,
    0.25 * scale,
    (matrix[3] - matrix[1]) / scale,
  ];
}

export function matrix3FromColumnMajor(elements) {
  return [
    elements[0],
    elements[4],
    elements[8],
    elements[1],
    elements[5],
    elements[9],
    elements[2],
    elements[6],
    elements[10],
  ];
}

export function multiplyMatrix3Vector(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function skinMatrixToRigid(elements) {
  const linear = matrix3FromColumnMajor(elements);
  const { rotation, symmetric } = polarDecompose3(linear);
  return {
    quaternion: quatNormalize(quatFromMatrix3(rotation)),
    translation: [elements[12], elements[13], elements[14]],
    scale: symmetric,
  };
}

export function makeSkinEvaluator({
  positions,
  joints,
  weights,
  inverseBindMatrices,
  ringStarts,
  segments,
}) {
  const vertexCount = positions.length / 3;
  let boneCount = Math.ceil(inverseBindMatrices.length / 16);
  for (let index = 0; index < joints.length; index += 1) {
    boneCount = Math.max(boneCount, joints[index] + 1);
  }
  const normalizedJoints = new Uint16Array(vertexCount * 4);
  const normalizedWeights = new Float32Array(vertexCount * 4);
  const usedCounts = new Uint8Array(vertexCount);
  let fallbackCount = 0;
  let maxRawSumError = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 4;
    const result = normalizeSkinWeights(
      joints.slice(offset, offset + 4),
      weights.slice(offset, offset + 4),
    );
    fallbackCount += result.fallback ? 1 : 0;
    maxRawSumError = Math.max(maxRawSumError, Math.abs(result.rawSum - 1));
    usedCounts[vertex] = result.weights.length;
    for (let influence = 0; influence < 4; influence += 1) {
      normalizedJoints[offset + influence] = result.joints[influence] ?? 0;
      normalizedWeights[offset + influence] = result.weights[influence] ?? 0;
    }
  }

  const bindPositions = Float32Array.from(positions);
  const lbsPositions = new Float32Array(positions.length);
  const dqPositions = new Float32Array(positions.length);

  function evaluate(skinMatrices, options = {}) {
    const scaleCompensation = options.scaleCompensation !== false;
    const boneMatrices = [];
    const boneRigid = [];
    let totalFlipped = 0;
    let maxFlipRatio = 0;

    for (let bone = 0; bone < boneCount; bone += 1) {
      const matrix =
        typeof skinMatrices[bone * 16] === "number"
          ? skinMatrices.slice(bone * 16, bone * 16 + 16)
          : skinMatrices[bone];
      const rigid = skinMatrixToRigid(matrix);
      boneMatrices.push(matrix);
      boneRigid.push({
        dq: dqFromRigid(rigid.quaternion, rigid.translation),
        scale: rigid.scale,
      });
    }

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 4;
      const base = vertex * 3;
      const point = [bindPositions[base], bindPositions[base + 1], bindPositions[base + 2]];
      const used = usedCounts[vertex];
      const influences = [];
      let matrix00 = 0;
      let matrix01 = 0;
      let matrix02 = 0;
      let matrix03 = 0;
      let matrix10 = 0;
      let matrix11 = 0;
      let matrix12 = 0;
      let matrix13 = 0;
      let matrix20 = 0;
      let matrix21 = 0;
      let matrix22 = 0;
      let matrix23 = 0;
      const scale = [0, 0, 0, 0, 0, 0, 0, 0, 0];

      for (let influence = 0; influence < used; influence += 1) {
        const weight = normalizedWeights[offset + influence];
        const bone = normalizedJoints[offset + influence];
        if (!weight || !boneRigid[bone]) continue;
        const matrix = boneMatrices[bone];
        matrix00 += matrix[0] * weight;
        matrix01 += matrix[4] * weight;
        matrix02 += matrix[8] * weight;
        matrix03 += matrix[12] * weight;
        matrix10 += matrix[1] * weight;
        matrix11 += matrix[5] * weight;
        matrix12 += matrix[9] * weight;
        matrix13 += matrix[13] * weight;
        matrix20 += matrix[2] * weight;
        matrix21 += matrix[6] * weight;
        matrix22 += matrix[10] * weight;
        matrix23 += matrix[14] * weight;
        influences.push({ dq: boneRigid[bone].dq, weight });
        if (scaleCompensation) {
          const boneScale = boneRigid[bone].scale;
          for (let index = 0; index < 9; index += 1) {
            scale[index] += boneScale[index] * weight;
          }
        }
      }

      lbsPositions[base] = matrix00 * point[0] + matrix01 * point[1] + matrix02 * point[2] + matrix03;
      lbsPositions[base + 1] = matrix10 * point[0] + matrix11 * point[1] + matrix12 * point[2] + matrix13;
      lbsPositions[base + 2] = matrix20 * point[0] + matrix21 * point[1] + matrix22 * point[2] + matrix23;

      const blended = blendDualQuaternions(influences);
      if (blended) {
        const scaled = scaleCompensation
          ? multiplyMatrix3Vector(scale, point)
          : point;
        const rotated = rotateByQuat(scaled, blended.real);
        dqPositions[base] = rotated[0] + blended.translation[0];
        dqPositions[base + 1] = rotated[1] + blended.translation[1];
        dqPositions[base + 2] = rotated[2] + blended.translation[2];
        totalFlipped += blended.flipped;
        maxFlipRatio = Math.max(maxFlipRatio, blended.flipped / influences.length);
      }
    }

    return {
      lbs: lbsPositions,
      dq: dqPositions,
      stats: {
        flippedInfluences: totalFlipped,
        maxFlipRatio,
        fallbackCount,
        maxRawSumError,
      },
    };
  }

  return {
    evaluate,
    bindPositions,
    normalizedJoints,
    normalizedWeights,
    usedCounts,
    ringStarts,
    segments,
    stats: { fallbackCount, maxRawSumError },
  };
}
