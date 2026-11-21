import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCamera, projectPoint } from '../src/camera.js';
import {
  anchor,
  overviewPose,
  scene,
  sitePose,
  sites,
  siteSeparationMeters,
} from '../src/data.js';

const output = resolve('artifacts');
const width = 1440;
const height = 810;
const fixed = (value) => value.toFixed(15);
const vectorFixed = (vector) => vector.map(fixed);

function publicSite(site) {
  return {
    id: site.id,
    name: site.name,
    shortName: site.shortName,
    geodetic: site.geodetic,
    ecef: site.ecef,
    ecefFixed: vectorFixed(site.ecef),
    localEnuToAnchor: site.anchorEnu,
    localEnuToAnchorFixed: vectorFixed(site.anchorEnu),
    localBasisEcef: {
      east: site.basis.east,
      north: site.basis.north,
      up: site.basis.up,
    },
  };
}

function publicMarker(marker) {
  const site = scene.siteById[marker.siteId];
  const localEnuToSite = [
    marker.ecef[0] - site.ecef[0],
    marker.ecef[1] - site.ecef[1],
    marker.ecef[2] - site.ecef[2],
  ];
  return {
    id: marker.id,
    siteId: marker.siteId,
    offsetCm: marker.offsetCm,
    ecef: marker.ecef,
    ecefFixed: vectorFixed(marker.ecef),
    localEnuToAnchor: marker.anchorEnu,
    localEnuToAnchorFixed: vectorFixed(marker.anchorEnu),
    ecefDeltaToSiteFixed: vectorFixed(localEnuToSite),
  };
}

const projection = { fovDegrees: 46, near: 0.01, far: 12000, width, height };
const overviewCamera = createCamera(overviewPose(), projection, anchor);
const bundCamera = createCamera(sitePose(scene.siteById.bund, 0.62), projection, anchor);
const lujiazuiCamera = createCamera(sitePose(scene.siteById.lujiazui, 0.62), projection, anchor);

const canonicalProjection = {};
for (const [name, camera] of [
  ['overview', overviewCamera],
  ['bund-close', bundCamera],
  ['lujiazui-close', lujiazuiCamera],
]) {
  canonicalProjection[name] = {
    eyeEcef: camera.eyeEcef,
    eyeEcefFixed: vectorFixed(camera.eyeEcef),
    targetEcef: camera.targetEcef,
    markers: Object.fromEntries(scene.markers.map((marker) => {
      const hit = projectPoint(camera, marker.anchorEnu);
      return [marker.id, {
        x: hit.x,
        y: hit.y,
        depth: hit.depth,
        visible: hit.visible,
      }];
    })),
  };
}

const reference = {
  schema: 'terra-local/cpu-reference@2',
  generatedAt: new Date().toISOString(),
  precision: 'IEEE-754 binary64 CPU project; WGS84 ECEF values are emitted as JSON numbers and decimal strings',
  anchor: {
    geodetic: anchor.geodetic,
    ecef: anchor.ecef,
    ecefFixed: vectorFixed(anchor.ecef),
    enuBasisEcef: anchor.basis,
  },
  siteSeparationMeters,
  sites: sites.map(publicSite),
  markers: scene.markers.map(publicMarker),
  canonicalProjection,
  transformChain: [
    'WGS84 geodetic (float64)',
    'ECEF (float64)',
    'shared anchor ENU (float64)',
    'RTC: subtract camera in float64, submit view-space float32 once',
    'HI/LO: split ECEF into float32 high + residual low, subtract both in the vertex shader',
    'picking: identical view transform plus a color-ID pass',
  ],
  projection,
};

await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'cpu-reference.json'),
  `${JSON.stringify(reference, null, 2)}\n`,
);
console.log(`wrote artifacts/cpu-reference.json (${scene.markers.length} markers)`);
