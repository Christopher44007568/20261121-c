import { normalize } from "./math.js";

export class MeshBuilder {
  constructor(partId, defaults = {}) {
    this.partId = partId;
    this.name = defaults.name || partId;
    this.color = defaults.color || [0.78, 0.8, 0.77];
    this.convex = defaults.convex !== false;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
  }

  vertex(position, normal, uv = [0, 0]) {
    const index = this.positions.length / 3;
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.uvs.push(uv[0], uv[1]);
    return index;
  }

  tri(a, b, c) {
    this.indices.push(a, b, c);
  }

  finish() {
    return {
      id: this.partId,
      name: this.name,
      color: this.color,
      convex: this.convex,
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(this.indices)
    };
  }
}

export function makePlane(partId, options = {}) {
  const width = options.width || 9;
  const depth = options.depth || 9;
  const y = options.y || 0;
  const segments = options.segments || 32;
  const builder = new MeshBuilder(partId, {
    name: options.name || "地面",
    color: options.color || [0.74, 0.76, 0.72]
  });
  const stride = segments + 1;
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const v = z / segments;
      builder.vertex(
        [(u - 0.5) * width, y, (v - 0.5) * depth],
        [0, 1, 0],
        [u, v]
      );
    }
  }
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      builder.tri(a, c, b);
      builder.tri(b, c, d);
    }
  }
  return builder.finish();
}

export function makeSphere(partId, options = {}) {
  const radius = options.radius ?? 1;
  const center = options.center || [0, radius, 0];
  const slices = options.slices || 48;
  const stacks = options.stacks || 24;
  const builder = new MeshBuilder(partId, {
    name: options.name || "球体",
    color: options.color || [0.8, 0.83, 0.82]
  });

  const north = [];
  for (let i = 0; i < slices; i++) {
    const u = (i + 0.5) / slices;
    north.push(builder.vertex(
      [center[0], center[1] + radius, center[2]],
      [0, 1, 0],
      [u, 0.002]
    ));
  }

  const rings = [];
  for (let j = 1; j < stacks; j++) {
    const v = j / stacks;
    const theta = v * Math.PI;
    const ring = [];
    for (let i = 0; i <= slices; i++) {
      const u = i / slices;
      const phi = u * Math.PI * 2;
      const normal = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      ];
      ring.push(builder.vertex(
        [
          center[0] + normal[0] * radius,
          center[1] + normal[1] * radius,
          center[2] + normal[2] * radius
        ],
        normal,
        [u, v]
      ));
    }
    rings.push(ring);
  }

  const south = [];
  for (let i = 0; i < slices; i++) {
    const u = (i + 0.5) / slices;
    south.push(builder.vertex(
      [center[0], center[1] - radius, center[2]],
      [0, -1, 0],
      [u, 0.998]
    ));
  }

  for (let i = 0; i < slices; i++) {
    builder.tri(north[i], rings[0][i + 1], rings[0][i]);
  }
  for (let j = 0; j < rings.length - 1; j++) {
    const a = rings[j];
    const b = rings[j + 1];
    for (let i = 0; i < slices; i++) {
      builder.tri(a[i], a[i + 1], b[i]);
      builder.tri(a[i + 1], b[i + 1], b[i]);
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < slices; i++) {
    builder.tri(last[i], last[i + 1], south[i]);
  }
  return builder.finish();
}

export function makeBox(partId, options = {}) {
  const center = options.center || [0, 0, 0];
  const size = options.size || [1, 1, 1];
  const segments = options.segments || 8;
  const builder = new MeshBuilder(partId, {
    name: options.name || "板件",
    color: options.color || [0.78, 0.8, 0.77]
  });
  const axes = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
  ];
  const pad = 0.012;
  for (let face = 0; face < axes.length; face++) {
    const [normal, right, up] = axes[face];
    const faceCol = face % 3;
    const faceRow = Math.floor(face / 3);
    const base = builder.positions.length / 3;
    const stride = segments + 1;
    const extentRight = Math.abs(right[0]) * size[0] + Math.abs(right[1]) * size[1] + Math.abs(right[2]) * size[2];
    const extentUp = Math.abs(up[0]) * size[0] + Math.abs(up[1]) * size[1] + Math.abs(up[2]) * size[2];
    const extentNormal = Math.abs(normal[0]) * size[0] + Math.abs(normal[1]) * size[1] + Math.abs(normal[2]) * size[2];
    for (let y = 0; y <= segments; y++) {
      for (let x = 0; x <= segments; x++) {
        const u = x / segments;
        const v = y / segments;
        const position = [
          center[0] + normal[0] * extentNormal / 2 + right[0] * (u - 0.5) * extentRight + up[0] * (v - 0.5) * extentUp,
          center[1] + normal[1] * extentNormal / 2 + right[1] * (u - 0.5) * extentRight + up[1] * (v - 0.5) * extentUp,
          center[2] + normal[2] * extentNormal / 2 + right[2] * (u - 0.5) * extentRight + up[2] * (v - 0.5) * extentUp
        ];
        const atlasU = (faceCol + pad + u * (1 - pad * 2)) / 3;
        const atlasV = (faceRow + pad + v * (1 - pad * 2)) / 2;
        builder.vertex(position, normal, [atlasU, atlasV]);
      }
    }
    for (let y = 0; y < segments; y++) {
      for (let x = 0; x < segments; x++) {
        const a = base + y * stride + x;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        builder.tri(a, b, c);
        builder.tri(b, d, c);
      }
    }
  }
  return builder.finish();
}

export function makeCylinder(partId, options = {}) {
  const center = options.center || [0, 1, 0];
  const radius = options.radius ?? 0.8;
  const height = options.height ?? 1.6;
  const segments = options.segments || 48;
  const heightSegments = options.heightSegments || 6;
  const builder = new MeshBuilder(partId, {
    name: options.name || "圆柱",
    color: options.color || [0.79, 0.81, 0.79]
  });

  const rows = [];
  for (let j = 0; j <= heightSegments; j++) {
    const row = [];
    const y = center[1] - height / 2 + (j / heightSegments) * height;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      row.push(builder.vertex(
        [center[0] + nx * radius, y, center[2] + nz * radius],
        [nx, 0, nz],
        [i / segments, 0.025 + (j / heightSegments) * 0.45]
      ));
    }
    rows.push(row);
  }
  for (let j = 0; j < heightSegments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = rows[j][i];
      const b = rows[j][i + 1];
      const c = rows[j + 1][i];
      const d = rows[j + 1][i + 1];
      builder.tri(a, c, b);
      builder.tri(b, c, d);
    }
  }

  function cap(top) {
    const y = center[1] + (top ? height / 2 : -height / 2);
    const normal = top ? [0, 1, 0] : [0, -1, 0];
    const cx = top ? 0.25 : 0.75;
    const cy = 0.76;
    const capCenter = builder.vertex([center[0], y, center[2]], normal, [cx, cy]);
    const rim = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      rim.push(builder.vertex(
        [center[0] + nx * radius, y, center[2] + nz * radius],
        normal,
        [cx + nx * 0.2, cy + nz * 0.2]
      ));
    }
    for (let i = 0; i < segments; i++) {
      if (top) builder.tri(capCenter, rim[i + 1], rim[i]);
      else builder.tri(capCenter, rim[i], rim[i + 1]);
    }
  }
  cap(true);
  cap(false);
  return builder.finish();
}
