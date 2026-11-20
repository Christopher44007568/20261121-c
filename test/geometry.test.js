import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNetwork } from '../src/network.js'
import { SCHEMES, TILE_SIZE, tileNetwork, tileBounds, GUARD } from '../src/tiling.js'
import { tessellateTile, buildJoinGroups } from '../src/tessellate.js'
import { TileCache } from '../src/cache.js'
import { meshTriangles, rasterize, compareCoverage, makeProjector } from '../src/coverage.js'

const network = buildNetwork()
const tiled = Object.fromEntries(SCHEMES.map((scheme) => [
  scheme.id, tileNetwork(scheme, network)
]))

test('两套方案使用不同的瓦片边界', () => {
  const node = network.junctions.find((junction) => junction.id === 'n1')
  const offsetA = (node.xy[0] - SCHEMES[0].origin[0]) / TILE_SIZE
  const offsetB = (node.xy[0] - SCHEMES[1].origin[0]) / TILE_SIZE
  assert.ok(Math.abs(offsetA - Math.round(offsetA)) > 1e-4)
  assert.ok(Math.abs(offsetB - Math.round(offsetB)) < 1e-4)
})

test('每个方案的瓦片无重叠地覆盖路网且带保护带', () => {
  for (const scheme of SCHEMES) {
    const { tiles } = tiled[scheme.id]
    assert.ok(tiles.length > 1)
    for (const tile of tiles) {
      const base = tileBounds(scheme, tile.tx, tile.ty)
      assert.equal(tile.clip.minX, base.minX - GUARD)
      assert.equal(tile.clip.maxX, base.maxX + GUARD)
    }
  }
})

test('T 节点所在瓦片内，两条地面路共享同一个连接组', () => {
  const node = network.junctions.find((junction) => junction.id === 'n1')
  const { tiles } = tiled.B
  let found = null
  for (const tile of tiles) {
    const groups = buildJoinGroups(tile.edges.filter((edge) => !edge.bridge))
    for (const [key, members] of groups) {
      const touchesNode = members.some((member) =>
        Math.abs(member.point[0] - node.xy[0]) < 1e-12 &&
        Math.abs(member.point[1] - node.xy[1]) < 1e-12)
      if (touchesNode) found = { key, members }
    }
  }
  assert.ok(found, 'n1 必须产生共享斜接组')
  assert.equal(found.members.length, 2)
  assert.deepEqual(found.members.map((member) => member.stroke.id).sort(), ['branch', 'main'])
})

test('overpass 节点处两条高架与地面路不共享连接组', () => {
  const node = network.junctions.find((junction) => junction.id === 'n4')
  const { tiles } = tiled.A
  const host = tiles.find((tile) => tile.junctions.some((junction) => junction.id === 'n4'))
  const groups = buildJoinGroups(host.edges)
  for (const members of groups.values()) {
    const onNode = members.some((member) =>
      Math.abs(member.point[0] - node.xy[0]) < 1e-12 &&
      Math.abs(member.point[1] - node.xy[1]) < 1e-12)
    if (onNode) assert.fail('overpass 不应产生共享斜接组')
  }
})

test('两套切割的屏幕像素覆盖在同一视口下完全一致', () => {
  const viewport = { width: 320, height: 240 }
  const matrix = [
    800, 0, 0, 0,
    0, -800, 0, 0,
    0, 0, 1, 0,
    -399.73, 401, 0, 1
  ]
  const project = makeProjector(matrix, viewport)
  const pixelToMerc = 1 / 800
  const masks = SCHEMES.map((scheme) => {
    const triangles = tiled[scheme.id].tiles.flatMap((tile) => {
      const mesh = tessellateTile(tile, pixelToMerc)
      return meshTriangles(mesh)
    })
    return rasterize(triangles, project, viewport)
  })
  const report = compareCoverage(masks[0], masks[1])
  assert.ok(report.countA > 100)
  assert.equal(report.symmetricDifference, 0)
  assert.equal(report.iou, 1)
})

test('缩放改变后两套切割覆盖仍然一致（无边界缝隙）', () => {
  const viewport = { width: 320, height: 240 }
  const zoomed = [
    1600, 0, 0, 0,
    0, -1600, 0, 0,
    0, 0, 1, 0,
    -799.47, 801, 0, 1
  ]
  const project = makeProjector(zoomed, viewport)
  const pixelToMerc = 1 / 1600
  const masks = SCHEMES.map((scheme) => {
    const triangles = tiled[scheme.id].tiles.flatMap((tile) =>
      meshTriangles(tessellateTile(tile, pixelToMerc)))
    return rasterize(triangles, project, viewport)
  })
  const report = compareCoverage(masks[0], masks[1])
  assert.equal(report.symmetricDifference, 0)
})

test('瓦片缓存：首次构建、再次命中、清空后重建', () => {
  const cache = new TileCache((tile) => tessellateTile(tile))
  const tile = tiled.A.tiles[0]
  const first = cache.get(tile)
  const second = cache.get(tile)
  assert.equal(first.hit, false)
  assert.equal(second.hit, true)
  assert.equal(second.mesh, first.mesh)
  assert.equal(cache.stats().hitRate, 0.5)
  cache.clear()
  assert.equal(cache.has(tile.key), false)
  const rebuilt = cache.get(tile)
  assert.equal(rebuilt.hit, false)
  assert.equal(cache.stats().misses, 2)
})
