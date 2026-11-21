import assert from 'node:assert/strict';
import test from 'node:test';
import { dot } from '../src/geo.js';
import { sites, tourDuration, tourFrame, tourStops } from '../src/data.js';

test('automatic tour visits both sites with a tangent local camera', () => {
  for (const [index, siteId] of ['bund', 'lujiazui'].entries()) {
    const stop = tourStops.find((item) => item.id === siteId);
    const frame = tourFrame(stop.start + stop.duration * 0.5);
    const site = sites[index];
    const range = Math.hypot(
      frame.pose.eye[0] - frame.pose.target[0],
      frame.pose.eye[1] - frame.pose.target[1],
      frame.pose.eye[2] - frame.pose.target[2],
    );
    const targetError = Math.hypot(
      frame.pose.target[0] - site.centerEnu[0],
      frame.pose.target[1] - site.centerEnu[1],
      frame.pose.target[2] - site.centerEnu[2],
    );
    assert.ok(range > 0.2 && range < 0.5);
    assert.ok(targetError < 0.02);
    assert.ok(dot(frame.pose.up, site.basis.up) > 0.9999);
  }
});

test('tour interpolates the entire loop without non-finite camera values', () => {
  for (let time = 0; time < tourDuration; time += 0.05) {
    const pose = tourFrame(time).pose;
    for (const value of [...pose.eye, ...pose.target, ...pose.up]) {
      assert.ok(Number.isFinite(value));
    }
    assert.ok(Math.hypot(...pose.up) > 0.99);
    assert.ok(Math.hypot(
      pose.eye[0] - pose.target[0],
      pose.eye[1] - pose.target[1],
      pose.eye[2] - pose.target[2],
    ) > 0.01);
  }
});
