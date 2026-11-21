export const WGS84 = Object.freeze({
  a: 6378137,
  f: 1 / 298.257223563,
  e2: (1 / 298.257223563) * (2 - 1 / 298.257223563),
});

export const DEG = Math.PI / 180;

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);

export function normalize(a) {
  const n = length(a);
  if (n < 1e-15) return [0, 0, 0];
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function geodeticToEcef(latitudeDeg, longitudeDeg, height) {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);
  return [
    (n + height) * cosLat * Math.cos(lon),
    (n + height) * cosLat * Math.sin(lon),
    (n * (1 - WGS84.e2) + height) * sinLat,
  ];
}

export function ecefToGeodetic(ecef) {
  const [x, y, z] = ecef;
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS84.e2));
  let height = 0;
  for (let i = 0; i < 12; i += 1) {
    const sinLat = Math.sin(lat);
    const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);
    height = p / Math.cos(lat) - n;
    const next = Math.atan2(z, p * (1 - (WGS84.e2 * n) / (n + height)));
    if (Math.abs(next - lat) < 1e-15) {
      lat = next;
      break;
    }
    lat = next;
  }
  return {
    latitude: lat / DEG,
    longitude: lon / DEG,
    height,
  };
}

export function enuBasis(latitudeDeg, longitudeDeg) {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  };
}

export function ecefToEnu(point, originEcef, basis) {
  const d = sub(point, originEcef);
  return [dot(d, basis.east), dot(d, basis.north), dot(d, basis.up)];
}

export function enuToEcef(point, originEcef, basis) {
  return [
    originEcef[0] + basis.east[0] * point[0] + basis.north[0] * point[1] + basis.up[0] * point[2],
    originEcef[1] + basis.east[1] * point[0] + basis.north[1] * point[1] + basis.up[1] * point[2],
    originEcef[2] + basis.east[2] * point[0] + basis.north[2] * point[1] + basis.up[2] * point[2],
  ];
}

export function basisToMatrix(basis) {
  return [
    basis.east[0], basis.north[0], basis.up[0],
    basis.east[1], basis.north[1], basis.up[1],
    basis.east[2], basis.north[2], basis.up[2],
  ];
}

export function transpose3(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function multiply3(a, b) {
  const out = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

export function transform3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function lookRotation(eye, target, upHint) {
  const forward = normalize(sub(target, eye));
  let right = cross(forward, upHint);
  if (length(right) < 1e-10) {
    const fallback = Math.abs(forward[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    right = cross(forward, fallback);
  }
  right = normalize(right);
  const up = normalize(cross(right, forward));
  return {
    forward,
    right,
    up,
    matrix: [
      right[0], right[1], right[2],
      up[0], up[1], up[2],
      -forward[0], -forward[1], -forward[2],
    ],
  };
}
