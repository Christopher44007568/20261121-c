import { tJunctionMercator } from './network.js'

// 两套瓦片网格对同一路网做切割。
// 方案 A：原点 (0,0) 的标准网格。
// 方案 B：网格 x 原点对齐 T 节点 n1，使该节点恰好落在瓦片边界上。
// 切割时向瓦片外扩 GUARD（保护带，世界单位），相邻瓦片在保护带内重叠，
// 保证缩放变化时边界两侧的描边三角形始终连续、屏幕上不出现缝隙。

export const TILE_SIZE = 0.02
export const GUARD = 0.002
const EPS = 1e-12

export const SCHEMES = [
  { id: 'A', origin: [0, 0] },
  { id: 'B', origin: [tJunctionMercator()[0], 0] }
]

function floorKey(value, size) {
  return Math.floor(value / size + 1e-10)
}

// 返回覆盖矩形 [minX,maxX]x[minY,maxY] 的瓦片键列表 [tx,ty]。
export function tilesCovering(scheme, minX, minY, maxX, maxY) {
  const [ox, oy] = scheme.origin
  const t0x = floorKey(minX - ox, TILE_SIZE)
  const t1x = floorKey(maxX - ox, TILE_SIZE)
  const t0y = floorKey(minY - oy, TILE_SIZE)
  const t1y = floorKey(maxY - oy, TILE_SIZE)
  const keys = []
  for (let ty = t0y; ty <= t1y; ty += 1) {
    for (let tx = t0x; tx <= t1x; tx += 1) {
      keys.push([tx, ty])
    }
  }
  return keys
}

export function tileBounds(scheme, tx, ty) {
  const [ox, oy] = scheme.origin
  return {
    minX: ox + tx * TILE_SIZE,
    minY: oy + ty * TILE_SIZE,
    maxX: ox + (tx + 1) * TILE_SIZE,
    maxY: oy + (ty + 1) * TILE_SIZE
  }
}

// Liang–Barsky 式半平面裁剪，逐边裁剪折线。
function clipPolyline(points, bounds) {
  let ring = points.map((point) => [...point])
  const planes = [
    (p) => p[0] >= bounds.minX,
    (p) => p[0] <= bounds.maxX,
    (p) => p[1] >= bounds.minY,
    (p) => p[1] <= bounds.maxY
  ]
  for (const inside of planes) {
    const output = []
    for (let i = 0; i < ring.length; i += 1) {
      const curr = ring[i]
      const prev = ring[i - 1]
      const currIn = inside(curr)
      if (prev) {
        const prevIn = inside(prev)
        if (prevIn !== currIn) output.push(intersect(prev, curr, inside, bounds))
      }
      if (currIn) output.push(curr)
    }
    ring = output
    // 仅合并完全重合的相邻点，保留折线内部拓扑/转弯顶点。
    ring = ring.filter((point, index) => {
      if (index === 0) return true
      const previous = ring[index - 1]
      return Math.abs(previous[0] - point[0]) > EPS ||
        Math.abs(previous[1] - point[1]) > EPS
    })
  }
  return ring
}

function intersect(p, q, inside, bounds) {
  let tLow = 0
  let tHigh = 1
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const checks = [
    [-dx, p[0] - bounds.minX],
    [dx, bounds.maxX - p[0]],
    [-dy, p[1] - bounds.minY],
    [dy, bounds.maxY - p[1]]
  ]
  for (const [pval, qval] of checks) {
    if (pval === 0) {
      if (qval < 0) return null
    } else {
      const ratio = qval / pval
      if (pval < 0) tLow = Math.max(tLow, ratio)
      else tHigh = Math.min(tHigh, ratio)
    }
  }
  const t = inside(p) ? tHigh : tLow
  return [p[0] + t * dx, p[1] + t * dy]
}

// 对路网做一次完整切割，返回方案下所有瓦片的绘制数据。
export function tileNetwork(scheme, network) {
  const allX = network.edges.flatMap((edge) => edge.points.map((p) => p[0]))
  const allY = network.edges.flatMap((edge) => edge.points.map((p) => p[1]))
  const minX = Math.min(...allX) - GUARD
  const maxX = Math.max(...allX) + GUARD
  const minY = Math.min(...allY) - GUARD
  const maxY = Math.max(...allY) + GUARD
  const tiles = tilesCovering(scheme, minX, minY, maxX, maxY).map(([tx, ty]) => {
    const base = tileBounds(scheme, tx, ty)
    const clip = {
      minX: base.minX - GUARD,
      minY: base.minY - GUARD,
      maxX: base.maxX + GUARD,
      maxY: base.maxY + GUARD
    }
    const edges = []
    for (const edge of network.edges) {
      const points = clipPolyline(edge.points, clip)
      if (points.length >= 2) {
        edges.push({
          id: edge.id,
          kind: edge.kind,
          bridge: edge.bridge,
          width: edge.width,
          points
        })
      }
    }
    const junctions = network.junctions.filter((junction) => (
      junction.xy[0] >= clip.minX && junction.xy[0] <= clip.maxX &&
      junction.xy[1] >= clip.minY && junction.xy[1] <= clip.maxY
    )).map((junction) => ({ ...junction }))
    return { key: `${scheme.id}-${tx}-${ty}`, tx, ty, base, clip, edges, junctions }
  })
  return { scheme, tiles }
}
