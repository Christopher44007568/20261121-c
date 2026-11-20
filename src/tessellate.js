// 宽描边细分：把折线展开成三角形带（miter 斜接 + 圆端帽），
// 高架路额外生成 casing 外套；T 节点共享斜接，overpass 不共享。
// 输出交错顶点数组与 16 位索引，顶点颜色打包为单 uint32。

export const VERTEX_FLOATS = 10 // cx,cy,nx,ny,halfWidth,layer,r,g,b,a
const EPS = 1e-9
const MITER_LIMIT = 2
const CAP_SEGMENTS = 8

const COLORS = {
  groundFill: [0.96, 0.82, 0.42, 1],
  groundCasing: [0.42, 0.35, 0.26, 1],
  bridgeFill: [0.78, 0.85, 0.95, 1],
  bridgeCasing: [0.2, 0.27, 0.4, 1],
  junctionT: [0.25, 0.75, 0.35, 1],
  overpass: [0.9, 0.35, 0.3, 1],
  gap: [0.12, 0.13, 0.16, 1]
}

function packColor(rgba) {
  return rgba.map((channel) => Math.round(channel * 255))
}

export class MeshBuilder {
  constructor() {
    this.vertices = []
    this.indices = []
  }

  addVertex(center, normal, halfWidth, layer, rgba) {
    const index = this.vertices.length / VERTEX_FLOATS
    this.vertices.push(center[0], center[1], normal[0], normal[1], halfWidth, layer, ...rgba)
    return index
  }

  addTriangle(a, b, c) {
    this.indices.push(a, b, c)
  }
}

function addQuad(builder, a, b, c, d) {
  builder.addTriangle(a, b, c)
  builder.addTriangle(a, c, d)
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1]) || 1
  return [vector[0] / length, vector[1] / length]
}

// 一条折线的宽描边。joinGroups：端点坐标 key -> 共享该端点的笔画集合。
// 属于组的端点不画端帽，由 addSharedJoins 统一生成斜接填充。
export function strokePolyline(builder, points, halfWidth, rgba, layer, joinGroups) {
  const left = []
  const right = []
  const n = points.length

  for (let i = 0; i < n; i += 1) {
    const point = points[i]
    let normal
    if (i === 0) {
      const direction = normalize([points[1][0] - point[0], points[1][1] - point[1]])
      normal = [-direction[1], direction[0]]
    } else if (i === n - 1) {
      const direction = normalize([point[0] - points[i - 1][0], point[1] - points[i - 1][1]])
      normal = [-direction[1], direction[0]]
    } else {
      const before = normalize([point[0] - points[i - 1][0], point[1] - points[i - 1][1]])
      const after = normalize([points[i + 1][0] - point[0], points[i + 1][1] - point[1]])
      const tangent = normalize([before[0] + after[0], before[1] + after[1]])
      normal = [-tangent[1], tangent[0]]
      const miterLength = 1 / Math.max(normal[0] * -before[1] + normal[1] * before[0], EPS)
      if (miterLength > MITER_LIMIT) {
        normal = [-before[1], before[0]]
      } else {
        normal = [normal[0] * miterLength, normal[1] * miterLength]
      }
    }
    left.push(builder.addVertex(point, normal, halfWidth, layer, rgba))
    right.push(builder.addVertex(point, [-normal[0], -normal[1]], halfWidth, layer, rgba))
  }

  for (let i = 0; i < n - 1; i += 1) {
    addQuad(builder, left[i], right[i], right[i + 1], left[i + 1])
  }

  // 圆端帽仅用于自由端；共享拓扑端点跳过。
  const startKey = keyOf(points[0])
  const endKey = keyOf(points[n - 1])
  if (!joinGroups.has(startKey)) addRoundCap(builder, points[0], points[1], halfWidth, rgba, layer, true)
  if (!joinGroups.has(endKey)) addRoundCap(builder, points[n - 1], points[n - 2], halfWidth, rgba, layer, false)
}

function addRoundCap(builder, center, neighbor, halfWidth, rgba, layer, isStart) {
  const direction = normalize([center[0] - neighbor[0], center[1] - neighbor[1]])
  const baseAngle = Math.atan2(direction[1], direction[0])
  const centerIndex = builder.addVertex(center, [0, 0], 0, layer, rgba)
  let previous = null
  for (let segment = 0; segment <= CAP_SEGMENTS; segment += 1) {
    const angle = baseAngle - Math.PI / 2 + (segment / CAP_SEGMENTS) * Math.PI
    const normal = [Math.cos(angle), Math.sin(angle)]
    const current = builder.addVertex(center, normal, halfWidth, layer, rgba)
    if (previous !== null) {
      if (isStart) builder.addTriangle(previous, centerIndex, current)
      else builder.addTriangle(centerIndex, previous, current)
    }
    previous = current
  }
}

function keyOf(point) {
  return `${Math.round(point[0] * 1e9)}:${Math.round(point[1] * 1e9)}`
}

// 收集瓦片内所有笔画端点；同一坐标出现多次即拓扑共享端点（T 节点）。
export function buildJoinGroups(strokes) {
  const groups = new Map()
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      const key = keyOf(point)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ point, stroke })
    }
  }
  for (const [key, members] of groups) {
    const strokesAt = new Set(members.map((member) => member.stroke))
    if (strokesAt.size < 2) groups.delete(key)
  }
  return groups
}

// 共享端点的斜接补洞：以节点为中心按角度排序笔画外缘点，做扇形三角化。
export function addSharedJoins(builder, joinGroups, widthOf) {
  for (const members of joinGroups.values()) {
    const center = members[0].point
    const centerIndex = builder.addVertex(center, [0, 0], 0, 0, COLORS.groundFill)
    const ring = []
    for (const member of members) {
      const stroke = member.stroke
      const pointIndex = stroke.points.findIndex((point) => keyOf(point) === keyOf(center))
      let direction
      if (pointIndex <= 0 || pointIndex === stroke.points.length - 1) {
        const isStart = pointIndex === 0
        const neighbor = isStart ? stroke.points[1] : stroke.points[stroke.points.length - 2]
        direction = normalize([center[0] - neighbor[0], center[1] - neighbor[1]])
      } else {
        const before = normalize([
          center[0] - stroke.points[pointIndex - 1][0],
          center[1] - stroke.points[pointIndex - 1][1]
        ])
        const after = normalize([
          stroke.points[pointIndex + 1][0] - center[0],
          stroke.points[pointIndex + 1][1] - center[1]
        ])
        direction = normalize([before[0] + after[0], before[1] + after[1]])
      }
      const normal = [-direction[1], direction[0]]
      const halfWidth = widthOf(stroke) / 2
      ring.push({
        angle: Math.atan2(normal[1], normal[0]),
        normal,
        halfWidth
      })
      ring.push({
        angle: Math.atan2(-normal[1], -normal[0]),
        normal: [-normal[0], -normal[1]],
        halfWidth
      })
    }
    ring.sort((a, b) => a.angle - b.angle)
    let previous = builder.addVertex(center, ring[ring.length - 1].normal,
      ring[ring.length - 1].halfWidth, 0, COLORS.groundFill)
    for (const item of ring) {
      const current = builder.addVertex(center, item.normal, item.halfWidth, 0, COLORS.groundFill)
      builder.addTriangle(previous, centerIndex, current)
      previous = current
    }
  }
}

function addDisk(builder, center, radius, rgba, layer = 0) {
  const centerIndex = builder.addVertex(center, [0, 0], 0, layer, rgba)
  let previous = null
  const segments = 18
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const normal = [Math.cos(angle), Math.sin(angle)]
    const current = builder.addVertex(center, normal, radius, layer, rgba)
    if (previous !== null) builder.addTriangle(centerIndex, previous, current)
    previous = current
  }
}

// pixelToMerc：1 屏幕像素对应的 Mercator 单位（=1/transform.worldSize）。
// 整瓦片：casing -> fill -> 共享斜接 -> 节点标记 -> 高架桥接间隙。
export function tessellateTile(tile, pixelToMerc = 1 / 9.6e6) {
  const builder = new MeshBuilder()
  const strokes = tile.edges.filter((edge) => !edge.bridge)
  const bridges = tile.edges.filter((edge) => edge.bridge)
  const joinGroups = buildJoinGroups(strokes)
  const world = (pixels) => pixels * pixelToMerc
  const widthOf = (stroke) => world(stroke.width)

  for (const edge of [...bridges, ...strokes]) {
    const fill = edge.bridge ? COLORS.bridgeFill : COLORS.groundFill
    const casing = edge.bridge ? COLORS.bridgeCasing : COLORS.groundCasing
    const groups = edge.bridge ? new Map() : joinGroups
    strokePolyline(builder, edge.points, world(edge.width / 2 + 2.5), casing, -1, groups)
    strokePolyline(builder, edge.points, world(edge.width / 2), fill, 0, groups)
  }
  addSharedJoins(builder, joinGroups, widthOf)

  for (const junction of tile.junctions) {
    const radius = world(junction.type === 't' ? 6 : 5)
    const color = junction.type === 't' ? COLORS.junctionT : COLORS.overpass
    addDisk(builder, junction.xy, radius, color, 1)
  }

  // 高架与地面路的交叉间隙符号：深色短横条，强调二者不连通。
  for (const junction of tile.junctions.filter((item) => item.type === 'overpass')) {
    addGapMarker(builder, junction.xy, world)
  }
  return { vertices: builder.vertices, indices: builder.indices }
}

function addGapMarker(builder, center, world) {
  const halfLength = world(12)
  const halfThickness = world(3)
  const corners = [
    { normal: [0, -1], half: halfLength },
    { normal: [1, 0], half: halfThickness },
    { normal: [0, 1], half: halfLength },
    { normal: [-1, 0], half: halfThickness }
  ].map(({ normal, half }) => builder.addVertex(
    center, normal, half, 1, COLORS.gap
  ))
  addQuad(builder, corners[0], corners[1], corners[2], corners[3])
}
