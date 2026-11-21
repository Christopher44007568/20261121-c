import { projectPoint } from './camera.js';
export const f32 = Math.fround;
export const f32v = (v) => [f32(v[0]), f32(v[1]), f32(v[2])];
export const f32m = (m) => m.map(f32);

function mulMat3F32(m, v) {
  return [
    f32(f32(f32(m[0] * v[0]) + f32(m[1] * v[1])) + f32(m[2] * v[2])),
    f32(f32(f32(m[3] * v[0]) + f32(m[4] * v[1])) + f32(m[5] * v[2])),
    f32(f32(f32(m[6] * v[0]) + f32(m[7] * v[1])) + f32(m[8] * v[2])),
  ];
}

export function splitHighLow(value) {
  const high = f32(value);
  return [high, value - high];
}

export function splitEcef(ecef) {
  return {
    hi: f32v(ecef.map((value) => splitHighLow(value)[0])),
    lo: f32v(ecef.map((value) => splitHighLow(value)[1])),
  };
}

function projectF32View(camera, view) {
  const vx = f32(view[0]);
  const vy = f32(view[1]);
  const vz = f32(view[2]);
  if (vz >= -camera.near || vz <= -camera.far) {
    return { visible: false, view: [vx, vy, vz], x: NaN, y: NaN, depth: -vz };
  }
  const focalX = f32(f32(camera.tanHalf * camera.aspect));
  const focalY = f32(camera.tanHalf);
  const z = -vz;
  const ndcX = f32(vx / f32(focalX * z));
  const ndcY = f32(vy / f32(focalY * z));
  const sx = f32((f32(ndcX * 0.5) + 0.5) * camera.width);
  const sy = f32((0.5 - f32(ndcY * 0.5)) * camera.height);
  return {
    visible: ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1,
    view: [vx, vy, vz],
    ndc: [ndcX, ndcY],
    x: sx,
    y: sy,
    depth: z,
  };
}

export function projectRTC(camera, pointEnu) {
  const view = [
    camera.view.matrix[0] * (pointEnu[0] - camera.eye[0]) +
      camera.view.matrix[1] * (pointEnu[1] - camera.eye[1]) +
      camera.view.matrix[2] * (pointEnu[2] - camera.eye[2]),
    camera.view.matrix[3] * (pointEnu[0] - camera.eye[0]) +
      camera.view.matrix[4] * (pointEnu[1] - camera.eye[1]) +
      camera.view.matrix[5] * (pointEnu[2] - camera.eye[2]),
    camera.view.matrix[6] * (pointEnu[0] - camera.eye[0]) +
      camera.view.matrix[7] * (pointEnu[1] - camera.eye[1]) +
      camera.view.matrix[8] * (pointEnu[2] - camera.eye[2]),
  ];
  return projectF32View(camera, view);
}

export function highLowView(camera, pointEcef) {
  const point = splitEcef(pointEcef);
  const eye = splitEcef(camera.eyeEcef);
  const relative = [];
  for (let i = 0; i < 3; i += 1) {
    const highDelta = f32(point.hi[i] - eye.hi[i]);
    const lowDelta = f32(point.lo[i] - eye.lo[i]);
    relative.push(f32(highDelta + lowDelta));
  }
  const rotation = f32m(camera.ecefToView);
  const view = mulMat3F32(rotation, relative);
  return { view, relative, rotation };
}

export function projectHilo(camera, pointEcef) {
  return projectF32View(camera, highLowView(camera, pointEcef).view);
}

export function absoluteF32View(camera, pointEcef) {
  const point = f32v(pointEcef);
  const eye = f32v(camera.eyeEcef);
  const relative = f32v([
    point[0] - eye[0],
    point[1] - eye[1],
    point[2] - eye[2],
  ]);
  const rotation = f32m(camera.ecefToView);
  return mulMat3F32(rotation, relative);
}

export function projectAbsoluteF32(camera, pointEcef) {
  return projectF32View(camera, absoluteF32View(camera, pointEcef));
}

export function projectReference(camera, pointEnu) {
  return projectPoint(camera, pointEnu);
}

export function projectForMode(mode, camera, marker) {
  if (mode === 'hilo') return projectHilo(camera, marker.ecef);
  return projectRTC(camera, marker.anchorEnu);
}

export function pixelError(a, b) {
  if (!a.visible || !b.visible) {
    const bothHidden = !a.visible && !b.visible;
    return bothHidden ? 0 : Infinity;
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pickCPU(camera, markers, x, y, radiusPx = 8, mode = 'rtc') {
  let best = null;
  for (const marker of markers) {
    const hit = projectForMode(mode, camera, marker);
    if (!hit.visible) continue;
    const distance = Math.hypot(hit.x - x, hit.y - y);
    if (distance > radiusPx) continue;
    if (!best || hit.depth < best.depth) {
      best = { marker, hit, depth: hit.depth, distance };
    }
  }
  return best;
}

export function relativeStability(camera, markers, leftProject, rightProject) {
  const errors = [];
  for (let i = 0; i < markers.length; i += 1) {
    for (let j = i + 1; j < markers.length; j += 1) {
      const aRef = projectReference(camera, markers[i].anchorEnu);
      const bRef = projectReference(camera, markers[j].anchorEnu);
      const aQ = rightProject(camera, markers[i]);
      const bQ = rightProject(camera, markers[j]);
      if (!aRef.visible || !bRef.visible || !aQ.visible || !bQ.visible) continue;
      const refDistance = Math.hypot(aRef.x - bRef.x, aRef.y - bRef.y);
      const quantizedDistance = Math.hypot(aQ.x - bQ.x, aQ.y - bQ.y);
      errors.push(Math.abs(quantizedDistance - refDistance));
    }
  }
  return errors;
}
