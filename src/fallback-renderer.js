import {
  GAPS,
  MASK,
  OBSTACLE,
  analyticVelocity,
  maskCode,
  sampleField,
} from "./flow.js";

export class FallbackRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.aspect = 1.5;
    this.seed = 3.71;
  }

  resize(cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, Math.floor(cssWidth * dpr));
    this.height = Math.max(260, Math.floor(cssHeight * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.aspect = this.width / this.height;
  }

  worldToScreen(x, y) {
    return {
      x: (x / this.aspect + 0.5) * this.width,
      y: (0.5 - y) * this.height,
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x / this.width - 0.5) * this.aspect,
      y: 0.5 - y / this.height,
    };
  }

  colorFor(velocity, alpha = 1) {
    const speed = Math.hypot(velocity.u, velocity.v);
    const east = Math.max(0, Math.min(1, velocity.u / Math.max(speed, 1e-4) * 0.5 + 0.5));
    const hue = 187 - east * 12 + Math.min(speed, 1.3) * 15;
    return `hsla(${hue}, 78%, ${44 + Math.min(speed, 1.2) * 18}%, ${alpha})`;
  }

  render(time, options, probe) {
    const ctx = this.ctx;
    const { width, height, aspect } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#071116");
    background.addColorStop(0.55, "#071218");
    background.addColorStop(1, "#090e17");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx);
    this.drawStreamlines(ctx, time, options);
    if (options.vectors) this.drawVectors(ctx, time, options);
    this.drawMasks(ctx, time, options);
    this.drawBoundary(ctx);
    this.drawProbe(ctx, time, probe);
  }

  drawGrid(ctx) {
    const { width, height, aspect } = this;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(150, 205, 196, 0.055)";
    ctx.beginPath();
    for (let x = -Math.floor(aspect * 10); x <= Math.ceil(aspect * 10); x += 1) {
      const sx = (x / 10 / aspect + 0.5) * width;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = -5; y <= 5; y += 1) {
      const sy = (0.5 - y / 10) * height;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  }

  drawStreamlines(ctx, time, options) {
    const { width, height, aspect } = this;
    const columns = Math.max(22, Math.round(aspect * 22));
    const rows = 15;
    ctx.lineCap = "round";

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const jitterX = Math.sin((row + 1) * 19.17 + column * 7.73) * 0.027;
        const jitterY = Math.cos(column * 11.31 + row * 5.29) * 0.023;
        let x = -aspect * 0.5 + ((column + 0.42) / columns) * aspect + jitterX;
        let y = -0.46 + ((row + 0.58) / rows) * 0.92 + jitterY;
        if (maskCode(x, y, aspect * 0.5, options) !== MASK.VALID) continue;

        const points = [{ x, y }];
        const step = 0.018;
        for (let i = 0; i < 23; i += 1) {
          const velocity = analyticVelocity(x, y, time - i * 0.012);
          x += velocity.u * step;
          y += velocity.v * step;
          if (
            Math.abs(x) > aspect * 0.5 ||
            Math.abs(y) > 0.5 ||
            maskCode(x, y, aspect * 0.5, options) !== MASK.VALID
          ) {
            break;
          }
          points.push({ x, y });
        }
        if (points.length < 3) continue;

        const phase = (time * 0.38 + (row * 0.173 + column * 0.119)) % 1;
        const start = Math.floor(phase * (points.length - 2));
        const end = Math.min(points.length - 1, start + 10);
        ctx.beginPath();
        for (let i = start; i <= end; i += 1) {
          const screen = this.worldToScreen(points[i].x, points[i].y);
          if (i === start) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        }
        const velocity = analyticVelocity(points[start].x, points[start].y, time);
        const gradient = ctx.createLinearGradient(
          this.worldToScreen(points[start].x, points[start].y).x,
          this.worldToScreen(points[start].x, points[start].y).y,
          this.worldToScreen(points[end].x, points[end].y).x,
          this.worldToScreen(points[end].x, points[end].y).y,
        );
        gradient.addColorStop(0, "rgba(92, 245, 220, 0)");
        gradient.addColorStop(0.6, this.colorFor(velocity, 0.6));
        gradient.addColorStop(1, "rgba(232, 255, 246, 0.8)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }
  }

  drawVectors(ctx, time, options) {
    const { aspect, width } = this;
    const spacing = 0.084;
    const countX = Math.floor(aspect / spacing);
    const countY = Math.floor(1 / spacing);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, width / 1450);
    for (let row = 0; row < countY; row += 1) {
      for (let column = 0; column < countX; column += 1) {
        const x = -aspect * 0.5 + (column + 0.5) * spacing;
        const y = -0.5 + (row + 0.5) * spacing;
        const field = sampleField(x, y, time, aspect * 0.5, options);
        if (field.mask !== MASK.VALID) continue;
        const angle = Math.atan2(field.v, field.u);
        const length = 0.72 + Math.min(field.speed, 1.4) * 0.5;
        const start = this.worldToScreen(x, y);
        const dx = Math.cos(angle) * spacing * 0.62 * length;
        const dy = -Math.sin(angle) * spacing * 0.62 * length;
        const tip = { x: start.x + dx, y: start.y + dy };
        ctx.strokeStyle = this.colorFor(field, 0.38);
        ctx.beginPath();
        ctx.moveTo(start.x - dx * 0.56, start.y - dy * 0.56);
        ctx.lineTo(tip.x, tip.y);
        const head = spacing * 0.2;
        for (const sign of [-1, 1]) {
          const angle2 = angle + Math.PI + sign * 0.58;
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(
            tip.x + Math.cos(angle2) * head,
            tip.y - Math.sin(angle2) * head,
          );
        }
        ctx.stroke();
      }
    }
  }

  drawMasks(ctx, time, options) {
    if (options.missing) {
      for (const gap of GAPS) {
        ctx.save();
        if (gap.type === "circle") {
          const center = this.worldToScreen(gap.x, gap.y);
          const radius = (gap.r / this.aspect) * this.width;
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = "#0b0911";
          ctx.fillRect(0, 0, this.width, this.height);
          ctx.strokeStyle = "rgba(191, 107, 255, 0.26)";
          ctx.lineWidth = 1;
          for (let offset = -this.height; offset < this.width; offset += 8) {
            ctx.beginPath();
            ctx.moveTo(offset, 0);
            ctx.lineTo(offset + this.height, this.height);
            ctx.stroke();
          }
          ctx.restore();
          ctx.strokeStyle = "rgba(200, 132, 255, 0.7)";
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const left = this.worldToScreen(gap.x - gap.hx, gap.y + gap.hy);
          const size = {
            x: (gap.hx * 2 / this.aspect) * this.width,
            y: gap.hy * 2 * this.height,
          };
          ctx.beginPath();
          ctx.rect(left.x, left.y, size.x, size.y);
          ctx.clip();
          ctx.fillStyle = "#0b0911";
          ctx.fillRect(0, 0, this.width, this.height);
          ctx.strokeStyle = "rgba(191, 107, 255, 0.25)";
          for (let offset = -this.height; offset < this.width; offset += 9) {
            ctx.beginPath();
            ctx.moveTo(offset, 0);
            ctx.lineTo(offset + this.height, this.height);
            ctx.stroke();
          }
          ctx.restore();
          ctx.strokeStyle = "rgba(200, 132, 255, 0.7)";
          ctx.setLineDash([4, 5]);
          ctx.strokeRect(left.x, left.y, size.x, size.y);
          ctx.setLineDash([]);
        }
      }
    }

    if (options.obstacle) {
      const center = this.worldToScreen(OBSTACLE.x, OBSTACLE.y);
      const radius = (OBSTACLE.r / this.aspect) * this.width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#0a1217";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.strokeStyle = "rgba(255, 196, 104, 0.16)";
      ctx.lineWidth = 1;
      for (let offset = -this.height; offset < this.width; offset += 7) {
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset + this.height, this.height);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255, 196, 104, 0.72)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 196, 104, 0.16)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius * 0.83, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawBoundary(ctx) {
    const gradientLeft = ctx.createLinearGradient(0, 0, this.width * 0.06, 0);
    gradientLeft.addColorStop(0, "rgba(92, 245, 220, 0.18)");
    gradientLeft.addColorStop(1, "rgba(92, 245, 220, 0)");
    ctx.fillStyle = gradientLeft;
    ctx.fillRect(0, 0, this.width * 0.06, this.height);
    const gradientRight = ctx.createLinearGradient(this.width, 0, this.width * 0.94, 0);
    gradientRight.addColorStop(0, "rgba(255, 131, 111, 0.14)");
    gradientRight.addColorStop(1, "rgba(255, 131, 111, 0)");
    ctx.fillStyle = gradientRight;
    ctx.fillRect(this.width * 0.94, 0, this.width * 0.06, this.height);
  }

  drawProbe(ctx, time, probe) {
    const field = analyticVelocity(probe.x, probe.y, time);
    const center = this.worldToScreen(probe.x, probe.y);
    const scale = this.width / 16;
    const angle = Math.atan2(field.v, field.u);
    ctx.strokeStyle = "rgba(255, 196, 104, 0.78)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 8, 0, Math.PI * 2);
    ctx.moveTo(center.x + 10, center.y);
    ctx.lineTo(
      center.x + 10 + Math.cos(angle) * scale * 0.65,
      center.y - Math.sin(angle) * scale * 0.65,
    );
    ctx.stroke();
  }
}
