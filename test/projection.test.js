import assert from 'node:assert/strict';
import test from 'node:test';
import { createCamera, projectPoint } from '../src/camera.js';
import { anchor, scene, sitePose, sites } from '../src/data.js';
import {
  pickCPU,
  projectAbsoluteF32,
  projectForMode,
  projectReference,
  relativeStability,
} from '../src/precision.js';

const projection = { fovDegrees: 46, near: 0.01, far: 12000, width: 1440, height: 810 };

test('RTC projection matches the float64 reference below 0.001 px', () => {
  for (const site of sites) {
    const camera = createCamera(sitePose(site, 0.62), projection, anchor);
    for (const marker of site.markers) {
      const reference = projectReference(camera, marker.anchorEnu);
      const rtc = projectForMode('rtc', camera, marker);
      const hilo = projectForMode('hilo', camera, marker);
      assert.equal(reference.visible, true);
      assert.ok(Math.hypot(reference.x - rtc.x, reference.y - rtc.y) < 0.001);
      assert.ok(Math.hypot(reference.x - hilo.x, reference.y - hilo.y) < 0.001);
    }
  }
});

test('direct absolute ECEF float32 collapses at close range', () => {
  const camera = createCamera(sitePose(sites[0], 0.62), projection, anchor);
  const reference = projectReference(camera, scene.markerById['A-05'].anchorEnu);
  const absolute = projectAbsoluteF32(camera, scene.markerById['A-05'].ecef);
  assert.ok(Math.hypot(reference.x - absolute.x, reference.y - absolute.y) > 100);
});

test('marker-to-marker spacing is stable while orbiting', () => {
  const rtcErrors = [];
  const hiloErrors = [];
  for (let index = 0; index < 32; index += 1) {
    const camera = createCamera(sitePose(sites[0], (index / 32) * Math.PI * 2), projection, anchor);
    rtcErrors.push(...relativeStability(
      camera,
      sites[0].markers,
      null,
      (cam, marker) => projectForMode('rtc', cam, marker),
    ));
    hiloErrors.push(...relativeStability(
      camera,
      sites[0].markers,
      null,
      (cam, marker) => projectForMode('hilo', cam, marker),
    ));
  }
  assert.ok(rtcErrors.length > 1000);
  assert.ok(Math.max(...rtcErrors) < 0.001);
  assert.ok(Math.max(...hiloErrors) < 0.001);
});

test('screen center agrees with the camera view ray', () => {
  const camera = createCamera(sitePose(sites[0], 0.62), projection, anchor);
  const target = projectPoint(camera, camera.target);
  assert.ok(Math.abs(target.x - camera.width / 2) < 1e-6);
  assert.ok(Math.abs(target.y - camera.height / 2) < 1e-6);
});
