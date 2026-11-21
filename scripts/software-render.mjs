import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  normalize
} from "../src/math.js";

function project(point, viewProj, width, height) {
  const [x, y, z] = point;
  const m = viewProj;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 1e-6) return null;
  return {
    x: (cx / cw * 0.5 + 0.5) * width,
    y: (0.5 - cy / cw * 0.5) * height,
    z: cz / cw,
    w: cw
  };
}

function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function background(width, height, rgba) {
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const r = Math.round(10 + 9 * (1 - t));
    const g = Math.round(15 + 12 * (1 - t));
    const b = Math.round(17 + 13 * (1 - t));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
}

export function renderReference(scene, ao, options = {}) {
  const width = options.width || 900;
  const height = options.height || 650;
  const scale = options.scale || 2;
  const W = width * scale;
  const H = height * scale;
  const mode = options.mode || "lit";
  const rgba = new Uint8Array(W * H * 4);
  background(W, H, rgba);
  const depth = new Float32Array(W * H).fill(Infinity);
  const camera = scene.camera;
  const view = mat4LookAt(camera.eye, camera.target);
  const projection = mat4Perspective(camera.fov * Math.PI / 180, W / H, 0.03, 80);
  const viewProj = mat4Multiply(projection, view);
  const light = normalize(scene.light);
  const fill = normalize([-0.65, 0.28, -0.52]);
  const { positions, normals, indices, partIds } = scene.mesh;

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const ids = [indices[triangle], indices[triangle + 1], indices[triangle + 2]];
    const projected = ids.map((index) =>
      project([positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]], viewProj, W, H)
    );
    if (projected.some((point) => !point)) continue;
    const minX = Math.max(0, Math.floor(Math.min(...projected.map((p) => p.x))));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(...projected.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...projected.map((p) => p.y))));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(...projected.map((p) => p.y))));
    if (maxX < minX || maxY < minY) continue;
    const [a, b, c] = projected;
    const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = edge(b.x, b.y, c.x, c.y, px, py) / area;
        const w1 = edge(c.x, c.y, a.x, a.y, px, py) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
        const z = w0 * a.z + w1 * b.z + w2 * c.z;
        const pixel = y * W + x;
        if (z >= depth[pixel]) continue;
        depth[pixel] = z;
        const normal = normalize([
          normals[ids[0] * 3] * w0 + normals[ids[1] * 3] * w1 + normals[ids[2] * 3] * w2,
          normals[ids[0] * 3 + 1] * w0 + normals[ids[1] * 3 + 1] * w1 + normals[ids[2] * 3 + 1] * w2,
          normals[ids[0] * 3 + 2] * w0 + normals[ids[1] * 3 + 2] * w1 + normals[ids[2] * 3 + 2] * w2
        ]);
        const shadow = ao[ids[0]] * w0 + ao[ids[1]] * w1 + ao[ids[2]] * w2;
        const part = scene.parts[Math.round(partIds[ids[0]])];
        const base = part?.color || [0.78, 0.8, 0.77];
        const key = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
        const bounce = Math.max(0, normal[0] * fill[0] + normal[1] * fill[1] + normal[2] * fill[2]);
        let r;
        let g;
        let blue;
        if (mode === "ao") {
          const value = 0.12 + 0.88 * Math.pow(shadow, 1.05);
          r = value * 0.98;
          g = value;
          blue = value * 0.98;
        } else {
          const lightAmount = 0.39 + key * 0.5 + bounce * 0.1;
          const aoAmount = 0.2 + 0.8 * Math.pow(shadow, 1.08);
          r = base[0] * lightAmount * aoAmount * 1.08;
          g = base[1] * lightAmount * aoAmount * 1.08;
          blue = base[2] * lightAmount * aoAmount * 1.08;
          r += 0.025 * (1 - shadow);
          g += 0.045 * (1 - shadow);
          blue += 0.05 * (1 - shadow);
          r = Math.pow(Math.max(0, Math.min(1, r)), 1 / 2.2);
          g = Math.pow(Math.max(0, Math.min(1, g)), 1 / 2.2);
          blue = Math.pow(Math.max(0, Math.min(1, blue)), 1 / 2.2);
        }
        const out = pixel * 4;
        rgba[out] = Math.round(r * 255);
        rgba[out + 1] = Math.round(g * 255);
        rgba[out + 2] = Math.round(blue * 255);
        rgba[out + 3] = 255;
      }
    }
  }

  const final = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y * scale + sy) * W + x * scale + sx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      }
      const count = scale * scale;
      const i = (y * width + x) * 4;
      final[i] = Math.round(r / count);
      final[i + 1] = Math.round(g / count);
      final[i + 2] = Math.round(b / count);
      final[i + 3] = 255;
    }
  }
  return { rgba: final, width, height, viewProj };
}

function setPixel(rgba, width, height, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (Math.floor(y) * width + Math.floor(x)) * 4;
  rgba[i] = Math.round(rgba[i] * (1 - alpha) + color[0] * alpha);
  rgba[i + 1] = Math.round(rgba[i + 1] * (1 - alpha) + color[1] * alpha);
  rgba[i + 2] = Math.round(rgba[i + 2] * (1 - alpha) + color[2] * alpha);
}

function circle(rgba, width, height, cx, cy, radius, color, thickness = 2) {
  const segments = 96;
  for (let i = 0; i < segments; i++) {
    const start = i / segments * Math.PI * 2;
    const end = (i + 1) / segments * Math.PI * 2;
    for (let t = 0; t <= 0.3; t += 0.03) {
      const angle = start + (end - start) * t;
      for (let r = radius - thickness; r <= radius + thickness; r += 0.5) {
        setPixel(rgba, width, height, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, color, 0.9);
      }
    }
  }
  for (let d = -radius - 4; d <= radius + 4; d++) {
    if (Math.abs(d) < radius - 3) continue;
    setPixel(rgba, width, height, cx + d, cy, color, 0.65);
    setPixel(rgba, width, height, cx, cy + d, color, 0.65);
  }
}

export function overlayDiagnostics(rendered, points, color = [226, 91, 82]) {
  const placed = [];
  for (const point of points) {
    const projected = project(point.position, rendered.viewProj, rendered.width, rendered.height);
    if (!projected) continue;
    if (projected.x < 0 || projected.y < 0 || projected.x > rendered.width || projected.y > rendered.height) continue;
    if (placed.some((other) => Math.hypot(other.x - projected.x, other.y - projected.y) < 18)) continue;
    if (placed.length >= 14) break;
    placed.push(projected);
    circle(rendered.rgba, rendered.width, rendered.height, projected.x, projected.y, 10, color, 1.5);
  }
  return rendered;
}
