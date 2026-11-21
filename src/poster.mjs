import { createCanvas } from "@napi-rs/canvas";

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function textBounds(text, font, x, baseline) {
  const scratch = createCanvas(8, 8);
  const ctx = scratch.getContext("2d");
  ctx.font = font;
  const metrics = ctx.measureText(text);
  return {
    x: x - 2,
    y: baseline - metrics.actualBoundingBoxAscent - 2,
    width: metrics.actualBoundingBoxRight + metrics.actualBoundingBoxLeft + 6,
    height:
      metrics.actualBoundingBoxAscent +
      metrics.actualBoundingBoxDescent +
      6,
  };
}

export function createPosterScene(width, height, { effectScale } = {}) {
  const u = Math.min(width / 1200, height / 900);
  const px = (value) => value * u;
  const fx = (value) => value * (effectScale ?? u);
  const ops = [];

  const background = (ctx, scene) => {
    const gradient = ctx.createLinearGradient(0, 0, scene.width, scene.height);
    gradient.addColorStop(0, "#080b1b");
    gradient.addColorStop(0.45, "#17122f");
    gradient.addColorStop(1, "#32111d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, scene.width, scene.height);
  };

  ops.push({
    id: "grid",
    bounds: { x: 0, y: 0, width, height },
    draw(ctx) {
      ctx.strokeStyle = "rgba(255, 232, 206, 0.045)";
      ctx.lineWidth = Math.max(1, px(1));
      const step = px(72);
      ctx.beginPath();
      for (let x = step; x < width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = step; y < height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    },
  });

  const halos = [
    { x: 0.16, y: 0.25, r: 0.23, color: "rgba(255, 104, 70, 0.45)", blur: 28 },
    { x: 0.82, y: 0.23, r: 0.19, color: "rgba(93, 169, 255, 0.38)", blur: 34 },
    { x: 0.67, y: 0.78, r: 0.28, color: "rgba(234, 74, 145, 0.28)", blur: 42 },
  ];
  for (const [index, halo] of halos.entries()) {
    const cx = width * halo.x;
    const cy = height * halo.y;
    const radius = Math.min(width, height) * halo.r;
    ops.push({
      id: `halo-${index}`,
      bounds: {
        x: cx - radius,
        y: cy - radius,
        width: radius * 2,
        height: radius * 2,
      },
      effects: {
        filter: { blur: fx(halo.blur) },
        opacity: 0.9,
      },
      draw(ctx) {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, halo.color);
        gradient.addColorStop(0.58, halo.color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  const panel = {
    x: width * 0.075,
    y: height * 0.2,
    width: width * 0.56,
    height: height * 0.61,
  };
  ops.push({
    id: "glass-panel",
    bounds: panel,
    effects: {
      shadow: {
        blur: fx(30),
        offsetX: fx(16),
        offsetY: fx(24),
        color: "rgba(0, 0, 0, 0.58)",
      },
    },
    draw(ctx) {
      const gradient = ctx.createLinearGradient(
        panel.x,
        panel.y,
        panel.x + panel.width,
        panel.y + panel.height,
      );
      gradient.addColorStop(0, "rgba(255, 248, 235, 0.16)");
      gradient.addColorStop(0.55, "rgba(255, 255, 255, 0.055)");
      gradient.addColorStop(1, "rgba(255, 177, 121, 0.08)");
      roundedRect(
        ctx,
        panel.x,
        panel.y,
        panel.width,
        panel.height,
        px(34),
      );
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 240, 218, 0.34)";
      ctx.lineWidth = px(2);
      ctx.stroke();
    },
  });

  const titleFont = `800 ${px(152)}px sans-serif`;
  const title = "NIGHT";
  const titleX = panel.x + px(62);
  const titleY = panel.y + px(242);
  const titleBox = textBounds(title, titleFont, titleX, titleY);
  ops.push({
    id: "masked-title",
    bounds: titleBox,
    effects: {
      shadow: {
        blur: fx(14),
        offsetX: 0,
        offsetY: fx(8),
        color: "rgba(255, 93, 55, 0.35)",
      },
      mask: {
        kind: "linear",
        blur: fx(2.5),
        from: [titleBox.x, titleY],
        to: [titleBox.x + titleBox.width * 0.72, titleY],
        stops: [
          [0, "rgba(0,0,0,1)"],
          [0.72, "rgba(0,0,0,0.08)"],
          [1, "rgba(0,0,0,0)"],
        ],
      },
    },
    draw(ctx) {
      const gradient = ctx.createLinearGradient(
        titleBox.x,
        titleY - titleBox.height,
        titleBox.x + titleBox.width,
        titleY,
      );
      gradient.addColorStop(0, "#fff7ea");
      gradient.addColorStop(0.58, "#ffb36b");
      gradient.addColorStop(1, "#ff5a46");
      ctx.font = titleFont;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = gradient;
      ctx.fillText(title, titleX, titleY);
    },
  });

  const subtitleFont = `500 ${px(31)}px sans-serif`;
  const subtitle = "TILED  /  VECTOR  /  SKIA";
  const subtitleX = panel.x + px(64);
  const subtitleY = panel.y + px(330);
  const subtitleBox = textBounds(
    subtitle,
    subtitleFont,
    subtitleX,
    subtitleY,
  );
  ops.push({
    id: "subtitle",
    bounds: subtitleBox,
    draw(ctx) {
      ctx.font = subtitleFont;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255, 245, 228, 0.82)";
      ctx.letterSpacing = `${px(2)}px`;
      ctx.fillText(subtitle, subtitleX, subtitleY);
      ctx.letterSpacing = "0px";
    },
  });

  const bar = {
    x: panel.x + px(64),
    y: panel.y + panel.height - px(92),
    width: panel.width - px(128),
    height: px(18),
  };
  ops.push({
    id: "masked-spectrum",
    bounds: bar,
    effects: {
      filter: { blur: fx(5) },
      mask: {
        kind: "linear",
        blur: fx(3),
        from: [bar.x, bar.y],
        to: [bar.x + bar.width, bar.y],
        stops: [
          [0, "rgba(0,0,0,0)"],
          [0.18, "rgba(0,0,0,1)"],
          [0.82, "rgba(0,0,0,1)"],
          [1, "rgba(0,0,0,0)"],
        ],
      },
    },
    draw(ctx) {
      const gradient = ctx.createLinearGradient(
        bar.x,
        bar.y,
        bar.x + bar.width,
        bar.y,
      );
      gradient.addColorStop(0, "#ff5c45");
      gradient.addColorStop(0.48, "#ffd18a");
      gradient.addColorStop(1, "#7ebcff");
      roundedRect(ctx, bar.x, bar.y, bar.width, bar.height, bar.height / 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    },
  });

  const stamp = {
    x: width * 0.72,
    y: height * 0.62,
    width: width * 0.18,
    height: width * 0.18,
  };
  ops.push({
    id: "shadow-stamp",
    bounds: stamp,
    effects: {
      shadow: {
        blur: fx(24),
        offsetX: fx(-12),
        offsetY: fx(18),
        color: "rgba(0, 0, 0, 0.62)",
      },
    },
    draw(ctx) {
      ctx.beginPath();
      ctx.arc(
        stamp.x + stamp.width / 2,
        stamp.y + stamp.height / 2,
        stamp.width / 2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#f5dfbb";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        stamp.x + stamp.width / 2,
        stamp.y + stamp.height / 2,
        stamp.width * 0.34,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = "#1a1425";
      ctx.lineWidth = px(7);
      ctx.stroke();
    },
  });

  return { width, height, background, ops };
}
