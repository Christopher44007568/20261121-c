import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dot,
  ecefToEnu,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  length,
} from '../src/geo.js';
import { anchor, scene, siteSeparationMeters } from '../src/data.js';

test('WGS84 geodetic/ECEF round-trips at centimeter scale', () => {
  const ecef = geodeticToEcef(31.24012, 121.48986, 8.6);
  const back = ecefToGeodetic(ecef);
  assert.ok(Math.abs(back.latitude - 31.24012) < 1e-10);
  assert.ok(Math.abs(back.longitude - 121.48986) < 1e-10);
  assert.ok(Math.abs(back.height - 8.6) < 1e-6);
  assert.ok(Math.abs(ecef[0] - scene.siteById.bund.ecef[0]) < 1e-9);
});

test('ECEF values are in the multi-million meter range', () => {
  for (const marker of scene.markers) {
    assert.ok(length(marker.ecef) > 6_000_000);
    assert.ok(Math.abs(marker.ecef[0]) > 2_000_000);
    assert.ok(Math.abs(marker.ecef[1]) > 4_000_000);
    assert.ok(Math.abs(marker.ecef[2]) > 3_000_000);
  }
});

test('shared ENU basis is orthonormal', () => {
  const basis = enuBasis(anchor.geodetic.latitude, anchor.geodetic.longitude);
  assert.ok(Math.abs(length(basis.east) - 1) < 1e-15);
  assert.ok(Math.abs(length(basis.north) - 1) < 1e-15);
  assert.ok(Math.abs(length(basis.up) - 1) < 1e-15);
  assert.ok(Math.abs(dot(basis.east, basis.north)) < 1e-15);
  assert.ok(Math.abs(dot(basis.east, basis.up)) < 1e-15);
  assert.ok(Math.abs(dot(basis.north, basis.up)) < 1e-15);
});

test('sites are 940 m apart on one WGS84 ENU anchor', () => {
  assert.ok(Math.abs(siteSeparationMeters - 940.585) < 0.01);
  const back = ecefToEnu(scene.sites[1].ecef, anchor.ecef, anchor.basis);
  const error = Math.hypot(
    back[0] - scene.sites[1].anchorEnu[0],
    back[1] - scene.sites[1].anchorEnu[1],
    back[2] - scene.sites[1].anchorEnu[2],
  );
  assert.ok(error < 1e-9);
});

test('centimeter marker offsets are applied in each site tangent frame', () => {
  for (const site of scene.sites) {
    const center = site.markers.find((marker) => marker.offsetCm.every((value) => value === 0));
    for (const marker of site.markers) {
      const delta = [
        marker.ecef[0] - center.ecef[0],
        marker.ecef[1] - center.ecef[1],
        marker.ecef[2] - center.ecef[2],
      ];
      const localEast = dot(delta, site.basis.east);
      const localNorth = dot(delta, site.basis.north);
      const localUp = dot(delta, site.basis.up);
      assert.ok(Math.abs(localEast - marker.offsetCm[0] * 0.01) < 1e-9);
      assert.ok(Math.abs(localNorth - marker.offsetCm[1] * 0.01) < 1e-9);
      assert.ok(Math.abs(localUp - marker.offsetCm[2] * 0.01) < 1e-9);
    }
  }
  const a = scene.markerById['A-01'].ecef;
  const b = scene.markerById['A-02'].ecef;
  assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 0.05) < 1e-9);
});
