import assert from 'node:assert/strict';
import test from 'node:test';
import { createCamera, projectPoint } from '../src/camera.js';
import { anchor, scene, sitePose, sites } from '../src/data.js';
import { pickCPU, projectForMode, projectReference } from '../src/precision.js';

const projection = { fovDegrees: 46, near: 0.01, far: 12000, width: 1440, height: 900 };

test('both coordinate strategies pick the marker under its projected center', () => {
  for (const site of sites) {
    const camera = createCamera(sitePose(site, 0.62), projection, anchor);
    for (const marker of site.markers) {
      const center = projectPoint(camera, marker.anchorEnu);
      assert.equal(center.visible, true);
      for (const mode of ['rtc', 'hilo']) {
        const hit = pickCPU(camera, scene.markers, center.x, center.y, 4.7, mode);
        assert.equal(hit?.marker.id, marker.id, `${mode} pick at ${marker.id}`);
      }
    }
  }
});

test('CPU ray and projected render path identify the same marker at every site', () => {
  for (const site of sites) {
    const camera = createCamera(sitePose(site, 1.37), projection, anchor);
    for (const marker of site.markers) {
      const rendered = projectForMode('rtc', camera, marker);
      assert.equal(rendered.visible, true);
      const rayPick = pickCPU(camera, scene.markers, rendered.x, rendered.y, 4.7, 'rtc');
      assert.equal(rayPick?.marker.id, marker.id);
    }
  }
});

test('picking rejects empty space outside every marker', () => {
  const camera = createCamera(sitePose(sites[0], 0.62), projection, anchor);
  const before = scene.markers.map((marker) => projectReference(camera, marker.anchorEnu));
  let x = 40;
  let y = 740;
  for (const point of before) {
    if (point.visible && Math.hypot(point.x - x, point.y - y) < 10) x += 20;
  }
  assert.equal(pickCPU(camera, scene.markers, x, y, 4.7, 'rtc'), null);
});
