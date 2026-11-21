import { projectPoint } from './camera.js';
import { projectAbsoluteF32 } from './precision.js';

function clipToViewport(x0, y0, x1, y1, width, height) {
  let tMin = 0;
  let tMax = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const tests = [
    [-dx, x0],
    [dx, width - x0],
    [-dy, y0],
    [dy, height - y0],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) tMin = Math.max(tMin, r);
    else tMax = Math.min(tMax, r);
    if (tMin > tMax) return null;
  }
  return {
    x0: x0 + dx * tMin,
    y0: y0 + dy * tMin,
    x1: x0 + dx * tMax,
    y1: y0 + dy * tMax,
  };
}

export class PrecisionOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
  }

  resize(width, height, pixelRatio) {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  draw(camera, scene, visible) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!visible) return;

    for (const marker of scene.markers) {
      const ref = projectPoint(camera, marker.anchorEnu);
      const absolute = projectAbsoluteF32(camera, marker.ecef);
      if (!ref.visible) continue;
      const targetX = Number.isFinite(absolute.x) ? absolute.x : ref.x + 1e4;
      const targetY = Number.isFinite(absolute.y) ? absolute.y : ref.y - 1e4;
      const clipped = clipToViewport(ref.x, ref.y, targetX, targetY, this.width, this.height);
      if (clipped) {
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(255, 86, 96, 0.42)';
        ctx.lineWidth = 0.75;
        ctx.moveTo(clipped.x0, clipped.y0);
        ctx.lineTo(clipped.x1, clipped.y1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const inside = targetX > 4 && targetX < this.width - 4 && targetY > 4 && targetY < this.height - 4;
      ctx.beginPath();
      ctx.arc(ref.x, ref.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(85, 246, 162, 0.96)';
      ctx.shadowColor = '#55f6a2';
      ctx.shadowBlur = 7;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (inside) {
        ctx.beginPath();
        ctx.arc(targetX, targetY, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 83, 94, 0.95)';
        ctx.fill();
      }
    }

    const first = scene.markers[0];
    const ref = projectPoint(camera, first.anchorEnu);
    if (ref.visible) {
      const absolute = projectAbsoluteF32(camera, first.ecef);
      ctx.font = '7px "Cascadia Mono", monospace';
      ctx.fillStyle = 'rgba(255, 118, 124, 0.82)';
      ctx.fillText(
        `ABS ECEF F32 Δ ${Math.hypot(absolute.x - ref.x, absolute.y - ref.y).toFixed(1)} PX`,
        Math.min(ref.x + 12, this.width - 180),
        Math.max(ref.y - 12, 18),
      );
    }
  }
}
