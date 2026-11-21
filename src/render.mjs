import { createCanvas } from "@napi-rs/canvas";
import { expandRect, rectsIntersect } from "./effects.mjs";

function applyShadow(ctx, shadow) {
  if (!shadow) {
    return;
  }
  ctx.shadowColor = shadow.color || "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = Math.max(0, Number(shadow.blur) || 0);
  ctx.shadowOffsetX = Number(shadow.offsetX) || 0;
  ctx.shadowOffsetY = Number(shadow.offsetY) || 0;
}

function canvasFilter(filter) {
  if (!filter) {
    return "none";
  }
  const parts = [];
  if (filter.blur > 0) {
    parts.push(`blur(${filter.blur}px)`);
  }
  if (filter.dropShadow) {
    const d = filter.dropShadow;
    const color = d.color || "rgba(0,0,0,0.35)";
    parts.push(
      `drop-shadow(${d.offsetX || 0}px ${d.offsetY || 0}px ${d.blur || 0}px ${color})`,
    );
  }
  if (filter.raw) {
    parts.push(filter.raw);
  }
  return parts.length ? parts.join(" ") : "none";
}

function linearMask(ctx, mask, bounds) {
  const from = mask.from || [bounds.x, bounds.y];
  const to = mask.to || [bounds.x + bounds.width, bounds.y];
  const gradient = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  for (const [offset, color] of mask.stops || [
    [0, "rgba(0,0,0,0)"],
    [1, "rgba(0,0,0,1)"],
  ]) {
    gradient.addColorStop(offset, color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function radialMask(ctx, mask, bounds) {
  const center = mask.center || [
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  ];
  const radius = mask.radius || Math.max(bounds.width, bounds.height) / 2;
  const gradient = ctx.createRadialGradient(
    center[0],
    center[1],
    Math.max(0, Number(mask.innerRadius) || 0),
    center[0],
    center[1],
    radius,
  );
  for (const [offset, color] of mask.stops || [
    [0, "rgba(0,0,0,1)"],
    [1, "rgba(0,0,0,0)"],
  ]) {
    gradient.addColorStop(offset, color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function paintMask(ctx, mask, bounds) {
  if (typeof mask.draw === "function") {
    mask.draw(ctx, bounds);
    return;
  }
  if (mask.kind === "radial") {
    radialMask(ctx, mask, bounds);
    return;
  }
  linearMask(ctx, mask, bounds);
}

function maskBounds(op) {
  return expandRect(op.bounds, op.margins?.shadow || 0);
}

function resetContext(ctx) {
  ctx.reset();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function getScratch(pool, key, width, height) {
  if (!pool) {
    const canvas = createCanvas(width, height);
    return { canvas, ctx: canvas.getContext("2d") };
  }

  let entry = pool[key];
  if (!entry || entry.canvas.width < width || entry.canvas.height < height) {
    const canvas = createCanvas(width, height);
    entry = { canvas, ctx: canvas.getContext("2d") };
    pool[key] = entry;
  }
  resetContext(entry.ctx);
  return entry;
}

function drawMaskedOp(ctx, op, viewport, scratchPool) {
  const content = getScratch(
    scratchPool,
    "content",
    viewport.width,
    viewport.height,
  );
  const scratch = content.canvas;
  const sctx = content.ctx;
  sctx.translate(-viewport.x, -viewport.y);

  sctx.save();
  applyShadow(sctx, op.effects?.shadow);
  op.draw(sctx);
  sctx.restore();

  const maskEntry = getScratch(
    scratchPool,
    "mask",
    viewport.width,
    viewport.height,
  );
  const maskCanvas = maskEntry.canvas;
  const mctx = maskEntry.ctx;
  mctx.translate(-viewport.x, -viewport.y);
  if (op.effects.mask.blur > 0) {
    mctx.filter = `blur(${op.effects.mask.blur}px)`;
  }
  paintMask(mctx, op.effects.mask, maskBounds(op));

  sctx.save();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = "destination-in";
  sctx.filter = "none";
  sctx.drawImage(maskCanvas, 0, 0);
  sctx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = "transparent";
  ctx.filter = canvasFilter(op.effects?.filter);
  if (op.effects?.opacity != null) {
    ctx.globalAlpha *= op.effects.opacity;
  }
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

function drawDirectOp(ctx, op) {
  ctx.save();
  applyShadow(ctx, op.effects?.shadow);
  ctx.filter = canvasFilter(op.effects?.filter);
  if (op.effects?.opacity != null) {
    ctx.globalAlpha *= op.effects.opacity;
  }
  op.draw(ctx);
  ctx.restore();
}

/**
 * Draws the scene in document coordinates. The caller clips to a render
 * viewport that includes the overlap apron.
 */
export function drawScene(ctx, scene, viewport, scratchPool) {
  ctx.save();
  ctx.translate(-viewport.x, -viewport.y);
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();
  scene.background(ctx, scene);

  for (const op of scene.ops) {
    if (!rectsIntersect(op.renderBounds, viewport)) {
      continue;
    }
    if (op.effects?.mask) {
      drawMaskedOp(ctx, op, viewport, scratchPool);
    } else {
      drawDirectOp(ctx, op);
    }
  }
  ctx.restore();
}

function viewportFor(scene, tile, apron) {
  const left = Math.max(0, tile.x - apron);
  const top = Math.max(0, tile.y - apron);
  const right = Math.min(scene.width, tile.x + tile.width + apron);
  const bottom = Math.min(scene.height, tile.y + tile.height + apron);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export class TileRenderer {
  constructor(scene, { tileWidth, tileHeight, apron }) {
    this.scene = scene;
    this.apron = apron;
    this.canvas = createCanvas(
      Math.min(scene.width, tileWidth + apron * 2),
      Math.min(scene.height, tileHeight + apron * 2),
    );
    this.ctx = this.canvas.getContext("2d");
    this.scratchPool = {};
  }

  render(tile) {
    const viewport = viewportFor(this.scene, tile, this.apron);
    resetContext(this.ctx);
    drawScene(this.ctx, this.scene, viewport, this.scratchPool);

    const image = this.ctx.getImageData(
      tile.x - viewport.x,
      tile.y - viewport.y,
      tile.width,
      tile.height,
    );
    return {
      ...tile,
      viewport,
      data: image.data,
    };
  }
}

export function renderTile(scene, tile, apron) {
  const viewport = viewportFor(scene, tile, apron);
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  drawScene(ctx, scene, viewport, {});

  const image = ctx.getImageData(
    tile.x - viewport.x,
    tile.y - viewport.y,
    tile.width,
    tile.height,
  );
  return {
    ...tile,
    viewport,
    data: image.data,
  };
}
