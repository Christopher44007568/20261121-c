// 屏幕空间软光栅：把两套瓦片切割产出的三角形投影到同一视口，
// 逐像素比较覆盖情况。不依赖 WebGL，Node 测试与浏览器 HUD 共用。

// viewport: { width, height }
// project: (x, y) => [px, py]，世界 Mercator 坐标 -> 屏幕像素
export function rasterize(triangles, project, viewport) {
  const covered = new Uint8Array(viewport.width * viewport.height)
  for (const triangle of triangles) {
    const screen = triangle.map(([x, y]) => project(x, y))
    fillTriangle(screen, covered, viewport.width, viewport.height)
  }
  return covered
}

function fillTriangle(points, covered, width, height) {
  const rawMinX = Math.min(...points.map((p) => p[0]))
  const rawMaxX = Math.max(...points.map((p) => p[0]))
  const rawMinY = Math.min(...points.map((p) => p[1]))
  const rawMaxY = Math.max(...points.map((p) => p[1]))
  if (rawMaxX < 0 || rawMinX >= width || rawMaxY < 0 || rawMinY >= height) return
  const minX = Math.max(0, Math.floor(rawMinX))
  const maxX = Math.min(width - 1, Math.ceil(rawMaxX))
  const minY = Math.max(0, Math.floor(rawMinY))
  const maxY = Math.min(height - 1, Math.ceil(rawMaxY))
  const [a, b, c] = points
  const area = edge(a, b, c)
  if (Math.abs(area) < 1e-9) return
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const sample = [px + 0.5, py + 0.5]
      const w0 = edge(b, c, sample) / area
      const w1 = edge(c, a, sample) / area
      const w2 = edge(a, b, sample) / area
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) covered[py * width + px] = 1
    }
  }
}

function edge(a, b, point) {
  return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
}

// 与 MapLibre mercator 矩阵一致的投影：mercator [0,1] -> 屏幕像素。
export function makeProjector(matrix, viewport) {
  return (x, y) => {
    const m = matrix
    const wx = m[0] * x + m[4] * y + m[12]
    const wy = m[1] * x + m[5] * y + m[13]
    const w = m[3] * x + m[7] * y + m[15]
    const ndcX = wx / w
    const ndcY = wy / w
    return [(ndcX * 0.5 + 0.5) * viewport.width, (0.5 - ndcY * 0.5) * viewport.height]
  }
}

// 从细分离散网格提取世界空间三角形，公式与顶点着色器一致：
// world = center + normal * halfWidth（halfWidth 已是当前缩放下的世界单位）。
// 顶点布局：cx,cy,nx,ny,halfWidth,layer,r,g,b,a
export function meshTriangles(mesh, stride = 10) {
  const result = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    result.push([0, 1, 2].map((offset) => {
      const base = mesh.indices[i + offset] * stride
      const cx = mesh.vertices[base]
      const cy = mesh.vertices[base + 1]
      const nx = mesh.vertices[base + 2]
      const ny = mesh.vertices[base + 3]
      const halfWidth = mesh.vertices[base + 4]
      return [
        cx + nx * halfWidth,
        cy + ny * halfWidth
      ]
    }))
  }
  return result
}

export function compareCoverage(maskA, maskB) {
  let onlyA = 0
  let onlyB = 0
  let both = 0
  const diff = new Uint8Array(maskA.length)
  for (let i = 0; i < maskA.length; i += 1) {
    if (maskA[i] && maskB[i]) both += 1
    else if (maskA[i]) {
      onlyA += 1
      diff[i] = 1
    } else if (maskB[i]) {
      onlyB += 1
      diff[i] = 2
    }
  }
  const union = both + onlyA + onlyB
  return {
    countA: countSet(maskA),
    countB: countSet(maskB),
    both,
    onlyA,
    onlyB,
    union,
    symmetricDifference: onlyA + onlyB,
    iou: union === 0 ? 1 : both / union,
    diff
  }
}

function countSet(mask) {
  let total = 0
  for (const value of mask) total += value
  return total
}
