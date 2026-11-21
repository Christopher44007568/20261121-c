import {
  add,
  basisToMatrix,
  clamp,
  ecefToEnu,
  enuBasis,
  geodeticToEcef,
  lerp3,
  normalize,
  scale,
  smoothstep,
} from './geo.js';

const ANCHOR_GEODETIC = Object.freeze({
  latitude: 31.2399,
  longitude: 121.4949,
  height: 8,
});

const SITE_DEFINITIONS = [
  {
    id: 'bund',
    name: '外滩 · 和平饭店',
    shortName: 'BUND',
    geodetic: { latitude: 31.24012, longitude: 121.48986, height: 8.6 },
    accent: '#55f6a2',
  },
  {
    id: 'lujiazui',
    name: '陆家嘴 · 东方明珠',
    shortName: 'LUJIAZUI',
    geodetic: { latitude: 31.23968, longitude: 121.49972, height: 13.2 },
    accent: '#5ef2d6',
  },
];

const OFFSETS_CM = [
  [-5, 5, 0], [0, 5, 0], [5, 5, 0],
  [-5, 0, 0], [0, 0, 0], [5, 0, 0],
  [-5, -5, 0], [0, -5, 0], [5, -5, 0],
];

function buildMarker(site, siteBasis, offsetCm, index) {
  const localOffset = scale(offsetCm, 0.01);
  const markerEcef = add(
    site.ecef,
    add(
      scale(siteBasis.east, localOffset[0]),
      add(scale(siteBasis.north, localOffset[1]), scale(siteBasis.up, localOffset[2])),
    ),
  );
  return {
    id: `${site.prefix}-${String(index + 1).padStart(2, '0')}`,
    siteId: site.id,
    offsetCm: [...offsetCm],
    localOffset,
    ecef: markerEcef,
  };
}

function buildScene() {
  const anchorBasis = enuBasis(ANCHOR_GEODETIC.latitude, ANCHOR_GEODETIC.longitude);
  const anchorEcef = geodeticToEcef(
    ANCHOR_GEODETIC.latitude,
    ANCHOR_GEODETIC.longitude,
    ANCHOR_GEODETIC.height,
  );
  const anchor = {
    geodetic: ANCHOR_GEODETIC,
    ecef: anchorEcef,
    basis: anchorBasis,
    matrix: basisToMatrix(anchorBasis),
  };

  const sites = SITE_DEFINITIONS.map((definition, siteIndex) => {
    const siteBasis = enuBasis(definition.geodetic.latitude, definition.geodetic.longitude);
    const siteEcef = geodeticToEcef(
      definition.geodetic.latitude,
      definition.geodetic.longitude,
      definition.geodetic.height,
    );
    const anchorEnu = ecefToEnu(siteEcef, anchor.ecef, anchor.basis);
    const prefix = definition.id === 'bund' ? 'A' : 'B';
    const site = {
      ...definition,
      prefix,
      basis: siteBasis,
      ecef: siteEcef,
      anchorEnu,
      markers: [],
    };
    site.markers = OFFSETS_CM.map((offset, index) =>
      buildMarker(site, siteBasis, offset, index),
    );
    site.centerEnu = add(anchorEnu, scale(siteBasis.up, 0.012));
    site.gridHalf = 0.85;
    site.gridStep = 0.05;
    site.siteIndex = siteIndex;
    return site;
  });

  for (const site of sites) {
    for (const marker of site.markers) {
      marker.anchorEnu = ecefToEnu(marker.ecef, anchor.ecef, anchor.basis);
    }
  }

  const markers = sites.flatMap((site) => site.markers);
  return {
    anchor,
    sites,
    markers,
    siteById: Object.fromEntries(sites.map((site) => [site.id, site])),
    markerById: Object.fromEntries(markers.map((marker) => [marker.id, marker])),
  };
}

export const scene = buildScene();
export const { anchor, sites, markers } = scene;

export const siteSeparationMeters = Math.hypot(
  sites[1].anchorEnu[0] - sites[0].anchorEnu[0],
  sites[1].anchorEnu[1] - sites[0].anchorEnu[1],
  sites[1].anchorEnu[2] - sites[0].anchorEnu[2],
);

export const CLOSE_RADIUS = 0.31;
export const CLOSE_HEIGHT = 0.17;

export function sitePose(site, angle = 0.65, radius = CLOSE_RADIUS, height = CLOSE_HEIGHT) {
  const eye = add(
    site.centerEnu,
    add(
      scale(site.basis.east, Math.cos(angle) * radius),
      add(scale(site.basis.north, Math.sin(angle) * radius), scale(site.basis.up, height)),
    ),
  );
  return {
    eye,
    target: add(site.centerEnu, scale(site.basis.up, 0.002)),
    up: site.basis.up,
  };
}

export function overviewPose(angle = 5.22) {
  const radius = 2200;
  const eye = [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    1280,
  ];
  return {
    eye,
    target: [0, 0, 0],
    up: [0, 0, 1],
  };
}

const TOUR_STOPS = [
  { id: 'overview', label: 'SHANGHAI / ANCHOR', duration: 4.2 },
  { id: 'to-bund', label: 'DESCEND / BUND', duration: 3.2 },
  { id: 'bund', label: 'BUND / 5 CM GRID', duration: 8.4, siteIndex: 0 },
  { id: 'to-lujiazui', label: 'TANGENT TRANSFER', duration: 4.8 },
  { id: 'lujiazui', label: 'LUJIAZUI / 5 CM GRID', duration: 8.4, siteIndex: 1 },
  { id: 'return', label: 'CLIMB / OVERVIEW', duration: 4.2 },
];

export const tourStops = TOUR_STOPS.map((stop, index) => {
  const start = TOUR_STOPS.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
  return { ...stop, start, end: start + stop.duration };
});

export const tourDuration = tourStops.at(-1).end;

function stopPose(stop, localTime) {
  const t = clamp(localTime / stop.duration, 0, 1);
  if (stop.id === 'overview') {
    return overviewPose(5.22 + t * 0.06);
  }
  if (stop.id === 'bund' || stop.id === 'lujiazui') {
    const site = sites[stop.siteIndex];
    return sitePose(site, 0.62 + t * Math.PI * 2);
  }
  return null;
}

function blendedPose(from, to, t) {
  return {
    eye: lerp3(from.eye, to.eye, t),
    target: lerp3(from.target, to.target, t),
    up: normalize(lerp3(from.up, to.up, t)),
  };
}

export function tourFrame(elapsed) {
  const time = ((elapsed % tourDuration) + tourDuration) % tourDuration;
  let index = tourStops.findIndex((stop) => time >= stop.start && time < stop.end);
  if (index < 0) index = tourStops.length - 1;
  const stop = tourStops[index];
  const localTime = time - stop.start;
  let pose = stopPose(stop, localTime);

  if (!pose) {
    const previous = tourStops[index - 1];
    const next = tourStops[index + 1];
    const from = previous.id === 'overview'
      ? overviewPose(5.22 + 0.06)
      : sitePose(sites[previous.siteIndex], 0.62 + Math.PI * 2);
    const to = !next || next.id === 'overview'
      ? overviewPose(5.22)
      : sitePose(sites[next.siteIndex], 0.62);
    pose = blendedPose(from, to, smoothstep(localTime / stop.duration));
  }

  return {
    pose,
    time,
    stop,
    stopIndex: index,
    progress: localTime / stop.duration,
    overall: time / tourDuration,
  };
}

export function tourPoseEndpoints() {
  return {
    overview: overviewPose(),
    bund: sitePose(sites[0]),
    lujiazui: sitePose(sites[1]),
  };
}
