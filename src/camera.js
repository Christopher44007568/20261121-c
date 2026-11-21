import {
  DEG,
  enuToEcef,
  lookRotation,
  multiply3,
  normalize,
  transform3,
  transpose3,
} from './geo.js';

export const DEFAULT_PROJECTION = Object.freeze({
  fovDegrees: 46,
  near: 0.01,
  far: 12000,
});

export function createCamera(pose, projection, anchor) {
  const eye = pose.eye;
  const target = pose.target;
  const up = pose.up || [0, 0, 1];
  const view = lookRotation(eye, target, up);
  const eyeEcef = enuToEcef(eye, anchor.ecef, anchor.basis);
  const targetEcef = enuToEcef(target, anchor.ecef, anchor.basis);
  const width = projection.width;
  const height = projection.height;
  const fovY = projection.fovDegrees * DEG;
  const tanHalf = Math.tan(fovY * 0.5);
  const aspect = width / height;
  const ecefToView = multiply3(
    view.matrix,
    transpose3([
      anchor.basis.east[0], anchor.basis.north[0], anchor.basis.up[0],
      anchor.basis.east[1], anchor.basis.north[1], anchor.basis.up[1],
      anchor.basis.east[2], anchor.basis.north[2], anchor.basis.up[2],
    ]),
  );
  return {
    eye,
    target,
    up: view.up,
    eyeEcef,
    targetEcef,
    view,
    width,
    height,
    aspect,
    fovDegrees: projection.fovDegrees,
    near: projection.near ?? DEFAULT_PROJECTION.near,
    far: projection.far ?? DEFAULT_PROJECTION.far,
    tanHalf,
    ecefToView,
  };
}

export function viewPosition(camera, pointEnu) {
  return transform3(camera.view.matrix, [
    pointEnu[0] - camera.eye[0],
    pointEnu[1] - camera.eye[1],
    pointEnu[2] - camera.eye[2],
  ]);
}

export function projectView(camera, view) {
  if (view[2] >= -camera.near || view[2] <= -camera.far) {
    return { visible: false, view, x: NaN, y: NaN, depth: -view[2] };
  }
  const ndcX = view[0] / (camera.tanHalf * camera.aspect * -view[2]);
  const ndcY = view[1] / (camera.tanHalf * -view[2]);
  return {
    visible: ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1,
    view,
    ndc: [ndcX, ndcY],
    x: (ndcX * 0.5 + 0.5) * camera.width,
    y: (0.5 - ndcY * 0.5) * camera.height,
    depth: -view[2],
  };
}

export function projectPoint(camera, pointEnu) {
  return projectView(camera, viewPosition(camera, pointEnu));
}

export function screenRay(camera, x, y) {
  const ndcX = (x / camera.width) * 2 - 1;
  const ndcY = 1 - (y / camera.height) * 2;
  const cameraDir = [
    ndcX * camera.tanHalf * camera.aspect,
    ndcY * camera.tanHalf,
    -1,
  ];
  const invView = transpose3(camera.view.matrix);
  return {
    origin: camera.eye,
    direction: normalize(transform3(invView, cameraDir)),
  };
}

export function screenFromNdc(width, height, ndcX, ndcY) {
  return [(ndcX * 0.5 + 0.5) * width, (0.5 - ndcY * 0.5) * height];
}
