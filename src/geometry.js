function pushQuad(out, a, b, c, d, normal) {
  const n = normal;
  for (const p of [a, b, c, a, c, d]) {
    out.push(p[0], p[1], p[2], n[0], n[1], n[2]);
  }
}

export function createGround(size = 40) {
  const s = size;
  const out = [];
  pushQuad(
    out,
    [-s, 0, -s],
    [s, 0, -s],
    [s, 0, s],
    [-s, 0, s],
    [0, 1, 0]
  );
  return new Float32Array(out);
}

export function createCylinder(base, radius, height, segments = 32) {
  const out = [];
  const [cx, cy, cz] = base;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const a0 = [cx + ca * radius, cy, cz + sa * radius];
    const a1 = [cx + ca * radius, cy + height, cz + sa * radius];
    const b0 = [cx + cb * radius, cy, cz + sb * radius];
    const b1 = [cx + cb * radius, cy + height, cz + sb * radius];
    const na = [ca, 0, sa];
    const nb = [cb, 0, sb];
    out.push(
      ...a0, ...na,
      ...a1, ...na,
      ...b1, ...nb,
      ...a0, ...na,
      ...b1, ...nb,
      ...b0, ...nb
    );
    if (i < segments) {
      out.push(
        cx, cy + height, cz, 0, 1, 0,
        a1[0], a1[1], a1[2], 0, 1, 0,
        b1[0], b1[1], b1[2], 0, 1, 0
      );
    }
  }
  return new Float32Array(out);
}

export function createBox(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const out = [];
  pushQuad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  pushQuad(out, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  pushQuad(out, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  pushQuad(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  pushQuad(out, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  return new Float32Array(out);
}
