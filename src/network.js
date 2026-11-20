// 合成路网：经度/纬度坐标。几何模块统一使用 Web Mercator 归一化坐标 [0,1]。
// 拓扑约定：
//   t        三路连通交点：相连的边共享描边斜接，不画端帽
//   bend     同一道路内的转弯点（斜接，非拓扑节点）
//   overpass 不连通交叉：两条路平面重合但无共享边，地面路保持连续，
//            高架路带独立 casing（描边外套）并在交叉处显示桥接间隙

// 关键拓扑节点（lon/lat）。n1 是 T 型三路交点；n4 是高架交叉点。
export const NODES = {
  n1: { id: 'n1', lon: 0.12, lat: 0.0, type: 't' },
  n4: { id: 'n4', lon: 0.1, lat: 0.0, type: 'overpass' }
}

// 道路边：points 为经纬度坐标链，bend 点写在链中间。
// ground 地面路；bridge 高架路（带 casing 与独立层级）。
export const EDGES = [
  {
    id: 'main', kind: 'ground', width: 14,
    points: [[0.08, 0], [0.1, 0], [0.12, 0], [0.14, 0.008], [0.16, 0.008]]
  },
  {
    id: 'branch', kind: 'ground', width: 9,
    points: [[0.12, -0.02], [0.112, -0.01], [0.12, 0]]
  },
  {
    id: 'bridgeS', kind: 'bridge', width: 10,
    points: [[0.1, 0.016], [0.1, 0.0045]]
  },
  {
    id: 'bridgeN', kind: 'bridge', width: 10,
    points: [[0.1, -0.0045], [0.1, -0.016]]
  }
]

export function lonLatToMerc(lon, lat) {
  const x = lon / 360 + 0.5
  const s = Math.sin((lat * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
  return [x, y]
}

export function buildNetwork() {
  const edges = EDGES.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    bridge: edge.kind === 'bridge',
    width: edge.width,
    points: edge.points.map(([lon, lat]) => lonLatToMerc(lon, lat))
  }))
  const junctions = Object.values(NODES).map((node) => ({
    id: node.id,
    type: node.type,
    xy: lonLatToMerc(node.lon, node.lat)
  }))
  return { edges, junctions }
}

export function tJunctionMercator() {
  return lonLatToMerc(NODES.n1.lon, NODES.n1.lat)
}
