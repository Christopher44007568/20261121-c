const PIXEL_SAFETY = 2;

/**
 * Canvas shadows reach roughly three sigma. Skia maps the Canvas blur radius
 * to two sigma, so 1.5 * radius is the usual support; 2 * radius is a
 * conservative, resolution-independent bound.
 */
export function shadowMargin(shadow = {}) {
  if (!shadow || shadow.blur <= 0 && !shadow.spread && !shadow.offsetX && !shadow.offsetY) {
    return 0;
  }

  const blur = Math.max(0, Number(shadow.blur) || 0);
  const spread = Math.max(0, Number(shadow.spread) || 0);
  const offset = Math.max(
    Math.abs(Number(shadow.offsetX) || 0),
    Math.abs(Number(shadow.offsetY) || 0),
  );

  return Math.ceil(blur * 2 + spread + offset);
}

/**
 * CSS/Canvas blur(radius) is a Gaussian standard deviation. Three sigma is
 * effectively invisible at 8 bit, and the extra pixel covers filtering
 * coordinate rounding.
 */
export function filterMargin(filter = {}) {
  if (!filter) {
    return 0;
  }

  const blur = Math.max(0, Number(filter.blur) || 0);
  const blurRadius = blur > 0 ? Math.ceil(blur * 3 + 1) : 0;
  const dropShadow = filter.dropShadow
    ? shadowMargin({ ...filter.dropShadow, spread: 0 })
    : 0;
  return blurRadius + dropShadow;
}

/**
 * A mask can only remove coverage, never enlarge the source. Its feather is
 * therefore not part of the apron. It does need to be painted over the full
 * source-plus-shadow rectangle so destination-in does not erase the shadow.
 */
export function maskMargin() {
  return 0;
}

export function effectMargins(effects = {}) {
  const shadow = shadowMargin(effects.shadow);
  const filter = filterMargin(effects.filter);
  const mask = maskMargin(effects.mask);
  const extra =
    Math.max(0, Number(effects.extraMargin) || 0) +
    Math.max(0, Number(effects.filter?.extraMargin) || 0);

  return {
    shadow,
    filter,
    mask,
    extra,
    total: shadow + filter + mask + extra,
  };
}

export function expandRect(rect, amount) {
  const by = Math.max(0, Math.ceil(amount));
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

export function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function normalizeRect(rect, id = "operation") {
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new TypeError(`${id}: bounds must be a finite, non-negative rectangle`);
  }
  return { ...rect };
}

/**
 * Compiles per-operation overlap requirements once, before any tile is
 * allocated. The returned scene is safe to share between workers.
 */
export function compileScene(scene) {
  if (!scene || !Number.isInteger(scene.width) || !Number.isInteger(scene.height)) {
    throw new TypeError("scene.width and scene.height must be integers");
  }
  if (scene.width <= 0 || scene.height <= 0) {
    throw new RangeError("scene dimensions must be positive");
  }
  if (typeof scene.background !== "function") {
    throw new TypeError("scene.background must be a drawing function");
  }
  if (!Array.isArray(scene.ops)) {
    throw new TypeError("scene.ops must be an array");
  }

  let maxMargin = 0;
  let hasMasks = false;
  const ops = scene.ops.map((op, index) => {
    const id = op.id || `op-${index}`;
    const bounds = normalizeRect(op.bounds, id);
    if (typeof op.draw !== "function") {
      throw new TypeError(`${id}: draw must be a function`);
    }

    const margins = effectMargins(op.effects);
    const margin = margins.total + PIXEL_SAFETY;
    const renderBounds = expandRect(bounds, margin);
    maxMargin = Math.max(maxMargin, margin);
    hasMasks ||= Boolean(op.effects?.mask);

    return {
      ...op,
      id,
      bounds,
      margins,
      margin,
      renderBounds,
    };
  });

  return {
    ...scene,
    ops,
    maxMargin,
    hasMasks,
  };
}

export { PIXEL_SAFETY };
