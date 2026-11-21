import * as THREE from "three";

const TEXTURE_SIZE = 512;

function smoothstep(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695041;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);
  const wrap = (value) => ((value % period) + period) % period;

  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
}

function fbm(u, v, seed) {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;

  for (let octave = 0; octave < 5; octave += 1) {
    const period = 2 << octave;
    value += periodicNoise(u * period, v * period, period, seed + octave * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }

  return value / total;
}

function buildHeightField(seed) {
  const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const u = x / TEXTURE_SIZE;
      const v = y / TEXTURE_SIZE;
      const broad = fbm(u, v, seed);
      const detail = fbm(u * 2, v * 2, seed + 71);
      const fine = fbm(u * 4, v * 4, seed + 137);
      const ridge = 1 - Math.abs(fbm(u * 2, v * 2, seed + 113) * 2 - 1);
      const fissure = Math.pow(1 - ridge, 7);
      const fineRidge = 1 - Math.abs(fbm(u * 4 + 2, v * 4 - 1, seed + 151) * 2 - 1);
      const fineFissure = Math.pow(1 - fineRidge, 9);
      const layerNoise = fbm(u * 2 + 3, v * 2 - 1, seed + 611);
      const strata =
        Math.sin((v * 7 + broad * 0.9 + (layerNoise - 0.5) * 1.8) * Math.PI * 2) * 0.5 +
        0.5;
      const height =
        broad * 0.53 + detail * 0.28 + fine * 0.06 + strata * 0.025 -
        fissure * 0.2 - fineFissure * 0.05;
      heights[y * TEXTURE_SIZE + x] = height;
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }

  const range = maximum - minimum;
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = (heights[index] - minimum) / range;
  }
  return heights;
}

function writeAlbedo(heights, seed) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  const image = context.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = y * TEXTURE_SIZE + x;
      const u = x / TEXTURE_SIZE;
      const v = y / TEXTURE_SIZE;
      const height = heights[index];
      const broad = fbm(u, v, seed + 331);
      const grit = periodicNoise(u * 64, v * 64, 64, seed + 301);
      const ridge = 1 - Math.abs(fbm(u * 2, v * 2, seed + 113) * 2 - 1);
      const fissure = Math.pow(1 - ridge, 7);
      const fineRidge = 1 - Math.abs(fbm(u * 4 + 2, v * 4 - 1, seed + 151) * 2 - 1);
      const fineFissure = Math.pow(1 - fineRidge, 9);
      const layerNoise = fbm(u * 2 + 5, v * 2 - 4, seed + 811);
      const strata =
        Math.sin((v * 7 + broad * 0.9 + (layerNoise - 0.5) * 1.8) * Math.PI * 2) * 0.5 +
        0.5;
      const patch = fbm(u * 2 + 1.4, v * 2 - 2.1, seed + 701);
      const veinField = Math.abs(fbm(u * 2 + 4, v * 2 - 2, seed + 503) - 0.5);
      const vein = 1 - smoothstep(0, 0.022, veinField);
      const lichenMask = smoothstep(
        0,
        1,
        (fbm(u * 2 + 7, v * 2 - 3, seed + 401) - 0.53) * 4.5,
      );
      const lichen = lichenMask * smoothstep(0.18, 0.5, height);

      const shade =
        0.44 +
        height * 0.48 +
        (broad - 0.5) * 0.25 +
        (patch - 0.5) * 0.14 +
        (grit - 0.5) * 0.055;
      const cavity = 1 - smoothstep(Math.min(1, height / 0.34));
      const crest = smoothstep((ridge - 0.84) * 7);
      const warm = strata * 0.035;
      let r = 72 * shade + warm * 35;
      let g = 74 * shade + warm * 30;
      let b = 66 * shade + warm * 18;
      r *= 1 - cavity * 0.42;
      g *= 1 - cavity * 0.42;
      b *= 1 - cavity * 0.38;

      r = r * (1 - lichen * 0.42) + 72 * lichen * 0.42;
      g = g * (1 - lichen * 0.42) + 86 * lichen * 0.42;
      b = b * (1 - lichen * 0.42) + 57 * lichen * 0.42;

      const quartz = Math.max(vein * 0.68, crest * 0.22);
      r = r * (1 - quartz * 0.54) + 132 * quartz * 0.54;
      g = g * (1 - quartz * 0.54) + 130 * quartz * 0.54;
      b = b * (1 - quartz * 0.54) + 112 * quartz * 0.54;

      const crack = Math.max(
        fissure * 0.62,
        fineFissure * 0.2,
        smoothstep((patch - 0.68) * 6) * 0.14,
      );
      r *= 1 - crack * 0.52;
      g *= 1 - crack * 0.52;
      b *= 1 - crack * 0.48;

      const dataOffset = index * 4;
      image.data[dataOffset] = Math.max(18, Math.min(255, r));
      image.data[dataOffset + 1] = Math.max(18, Math.min(255, g));
      image.data[dataOffset + 2] = Math.max(18, Math.min(255, b));
      image.data[dataOffset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

function writeNormalMap(heights) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  const image = context.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const sample = (x, y) => {
    const wrappedX = (x + TEXTURE_SIZE) % TEXTURE_SIZE;
    const wrappedY = (y + TEXTURE_SIZE) % TEXTURE_SIZE;
    return heights[wrappedY * TEXTURE_SIZE + wrappedX];
  };
  const strength = 4.2;

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);
      const dx = tl + 2 * l + bl - tr - 2 * r - br;
      const dy = tl + 2 * t + tr - bl - 2 * b - br;
      const normal = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();

      const dataOffset = (y * TEXTURE_SIZE + x) * 4;
      image.data[dataOffset] = (normal.x * 0.5 + 0.5) * 255;
      image.data[dataOffset + 1] = (normal.y * 0.5 + 0.5) * 255;
      image.data[dataOffset + 2] = (normal.z * 0.5 + 0.5) * 255;
      image.data[dataOffset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

export function createRockTextures(renderer) {
  const seed = 1947;
  const heights = buildHeightField(seed);
  const albedoMap = new THREE.CanvasTexture(writeAlbedo(heights, seed));
  const normalMap = new THREE.CanvasTexture(writeNormalMap(heights));

  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const texture of [albedoMap, normalMap]) {
    texture.anisotropy = anisotropy;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
  }

  return { albedoMap, normalMap };
}
