export const MAX_PICK_ID = 0xffffff;
export const DISPLAY_LAYER_PICK_ID = 0;

export function clampPickId(id) {
  if (!Number.isFinite(id)) return DISPLAY_LAYER_PICK_ID;
  return Math.max(DISPLAY_LAYER_PICK_ID, Math.min(MAX_PICK_ID, Math.floor(id)));
}

export function encodeIdChannels(id) {
  const value = clampPickId(id);
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
  ];
}

export function decodeIdChannels(red, green, blue) {
  return (red & 0xff) | ((green & 0xff) << 8) | ((blue & 0xff) << 16);
}

export function decodeIdAt(buffer, byteOffset) {
  return decodeIdChannels(buffer[byteOffset], buffer[byteOffset + 1], buffer[byteOffset + 2]);
}

export function formatPickId(id) {
  return `0x${clampPickId(id).toString(16).toUpperCase().padStart(6, "0")}`;
}

export function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function clampRectToViewport(rect, viewport) {
  const left = Math.max(0, Math.min(viewport.width, rect.x));
  const top = Math.max(0, Math.min(viewport.height, rect.y));
  const right = Math.max(0, Math.min(viewport.width, rect.x + rect.width));
  const bottom = Math.max(0, Math.min(viewport.height, rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function cssRectToBufferRect(rect, cssSize, bufferSize) {
  const safeCssWidth = Math.max(1, cssSize.width);
  const safeCssHeight = Math.max(1, cssSize.height);
  const sx = bufferSize.width / safeCssWidth;
  const sy = bufferSize.height / safeCssHeight;
  const left = Math.max(0, Math.min(bufferSize.width, Math.floor(rect.x * sx)));
  const top = Math.max(0, Math.min(bufferSize.height, Math.floor(rect.y * sy)));
  const right = Math.max(left, Math.min(bufferSize.width, Math.ceil((rect.x + rect.width) * sx)));
  const bottom = Math.max(top, Math.min(bufferSize.height, Math.ceil((rect.y + rect.height) * sy)));
  const width = right - left;
  const height = bottom - top;

  return {
    x: left,
    y: bufferSize.height - bottom,
    top,
    width,
    height,
    scaleX: sx,
    scaleY: sy,
  };
}

export function scaleCssRect(rect, fromViewport, toViewport) {
  const sx = toViewport.width / Math.max(1, fromViewport.width);
  const sy = toViewport.height / Math.max(1, fromViewport.height);
  return {
    x: rect.x * sx,
    y: rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

export function manifestFingerprint(hits, pixelCount = 0) {
  const hitPart = hits
    .filter((hit) => hit.verified)
    .map((hit) => `${hit.pickId}:${hit.pixelCount}`)
    .sort()
    .join("|");
  return `${pixelCount}/${hitPart}`;
}

export function compareHitManifests(expected, actual) {
  const index = (hits) => new Map(hits.map((hit) => [hit.pickId, hit.pixelCount]));
  const left = index(expected);
  const right = index(actual);
  const missing = [];
  const extra = [];
  const pixelDeltas = [];

  for (const [pickId, count] of left) {
    if (!right.has(pickId)) {
      missing.push(pickId);
      continue;
    }
    if (right.get(pickId) !== count) {
      pixelDeltas.push({ pickId, expected: count, actual: right.get(pickId) });
    }
  }

  for (const pickId of right.keys()) {
    if (!left.has(pickId)) extra.push(pickId);
  }

  return {
    equal: missing.length === 0 && extra.length === 0 && pixelDeltas.length === 0,
    missing,
    extra,
    pixelDeltas,
  };
}
