import { buildNetwork, NODES } from './network.js'
import { SCHEMES, tileNetwork } from './tiling.js'
import { tessellateTile } from './tessellate.js'
import { RoadLayer } from './layer.js'
import {
  meshTriangles, rasterize, compareCoverage
} from './coverage.js'

const network = buildNetwork()
const maplibregl = window.maplibregl
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: []
  },
  center: [NODES.n1.lon, NODES.n1.lat],
  zoom: 14.2,
  minZoom: 11,
  maxZoom: 19
})

const roadLayer = new RoadLayer('road-topology', network, SCHEMES)
const tiled = new Map(SCHEMES.map((scheme) => [
  scheme.id, tileNetwork(scheme, network)
]))

map.on('load', () => {
  map.addLayer(roadLayer)
  addBoundaryLayers()
  bindControls()
  map.once('idle', runCoverageComparison)
  requestAnimationFrame(() => updateCacheHud())
  map.on('moveend', () => {
    runCoverageComparison()
    updateCacheHud()
  })
  map.on('zoomend', () => map.once('idle', runCoverageComparison))
})

function addBoundaryLayers() {
  for (const scheme of SCHEMES) {
    const features = tiled.get(scheme.id).tiles.map((tile) => ({
      type: 'Feature',
      properties: { key: tile.key },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          mercToLonLat(tile.base.minX, tile.base.minY),
          mercToLonLat(tile.base.maxX, tile.base.minY),
          mercToLonLat(tile.base.maxX, tile.base.maxY),
          mercToLonLat(tile.base.minX, tile.base.maxY),
          mercToLonLat(tile.base.minX, tile.base.minY)
        ]]
      }
    }))
    map.addSource(`boundary-${scheme.id}`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    })
    map.addLayer({
      id: `boundary-${scheme.id}`,
      type: 'line',
      source: `boundary-${scheme.id}`,
      paint: {
        'line-color': scheme.id === 'A' ? '#5b91ff' : '#ff8f5b',
        'line-width': 1,
        'line-dasharray': [2, 2]
      },
      layout: { visibility: scheme.id === 'A' ? 'visible' : 'none' }
    })
  }
}

function mercToLonLat(x, y) {
  const lon = (x - 0.5) * 360
  const n = Math.PI * (1 - 2 * y)
  const lat = (360 / Math.PI) * Math.atan(Math.exp(n)) - 90
  return [lon, lat]
}

function bindControls() {
  document.querySelectorAll('input[name="scheme"]').forEach((input) => {
    input.addEventListener('change', () => {
      roadLayer.setScheme(input.value)
      SCHEMES.forEach((scheme) => {
        map.setLayoutProperty(
          `boundary-${scheme.id}`,
          'visibility',
          scheme.id === input.value && roadLayer.showBoundaries ? 'visible' : 'none'
        )
      })
      updateCacheHud()
      runCoverageComparison()
    })
  })
  document.querySelector('#boundaries').addEventListener('change', (event) => {
    roadLayer.setShowBoundaries(event.target.checked)
    SCHEMES.forEach((scheme) => {
      map.setLayoutProperty(
        `boundary-${scheme.id}`,
        'visibility',
        scheme.id === roadLayer.activeScheme && event.target.checked ? 'visible' : 'none'
      )
    })
  })
  document.querySelector('#clearCache').addEventListener('click', () => {
    roadLayer.clearCaches()
    appendCacheLog('缓存已清空，下一次渲染将全部重建')
    updateCacheHud()
  })
  document.querySelector('#rerunCompare').addEventListener('click', runCoverageComparison)
}

function currentProjector() {
  const transform = map.transform
  const left = transform.point.x - transform.width / 2
  const top = transform.point.y - transform.height / 2
  const worldSize = transform.worldSize
  return (x, y) => {
    return [x * worldSize - left, y * worldSize - top]
  }
}

function runCoverageComparison() {
  try {
    const viewport = { width: map.transform.width, height: map.transform.height }
    const project = currentProjector()
    const pixelToMerc = 1 / map.transform.worldSize
    const masks = SCHEMES.map((scheme) => {
      const triangles = tiled.get(scheme.id).tiles.flatMap((tile) =>
        meshTriangles(tessellateTile(tile, pixelToMerc)))
      return rasterize(triangles, project, viewport)
    })
    const report = compareCoverage(masks[0], masks[1])
    renderCoverageTable(report)
    renderDiffCanvas(report, viewport)
  } catch (error) {
    document.querySelector('#coverageTable').innerHTML =
      `<tr><td>比较失败</td><td>${error.message}</td></tr>`
  }
}

function renderCoverageTable(report) {
  const rows = [
    ['方案 A 覆盖像素', report.countA],
    ['方案 B 覆盖像素', report.countB],
    ['两者共同覆盖', report.both],
    ['仅 A 覆盖', report.onlyA],
    ['仅 B 覆盖', report.onlyB],
    ['对称差像素', report.symmetricDifference],
    ['IoU 一致度', report.iou.toFixed(6)]
  ]
  document.querySelector('#coverageTable').innerHTML = rows
    .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
    .join('')
}

function renderDiffCanvas(report, viewport) {
  const canvas = document.querySelector('#diffCanvas')
  const context = canvas.getContext('2d')
  context.fillStyle = '#0a0c10'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const image = context.createImageData(canvas.width, canvas.height)
  const scaleX = canvas.width / viewport.width
  const scaleY = canvas.height / viewport.height
  for (let py = 0; py < canvas.height; py += 1) {
    for (let px = 0; px < canvas.width; px += 1) {
      const sourceIndex = Math.floor(py / scaleY) * viewport.width +
        Math.floor(px / scaleX)
      const value = report.diff[sourceIndex]
      const offset = (py * canvas.width + px) * 4
      if (value === 1) {
        image.data.set([91, 145, 255, 255], offset)
      } else if (value === 2) {
        image.data.set([255, 143, 91, 255], offset)
      }
    }
  }
  context.putImageData(image, 0, 0)
}

function updateCacheHud() {
  const stats = roadLayer.caches.get(roadLayer.activeScheme)?.stats()
  if (!stats) return
  const rows = [
    ['缓存瓦片数', stats.size],
    ['命中次数', stats.hits],
    ['未命中（构建）', stats.misses],
    ['清空次数', stats.evictions],
    ['命中率', `${(stats.hitRate * 100).toFixed(1)}%`]
  ]
  document.querySelector('#cacheTable').innerHTML = rows
    .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
    .join('')
}

function appendCacheLog(message, className = '') {
  const log = document.querySelector('#cacheLog')
  const line = document.createElement('div')
  const time = new Date().toLocaleTimeString()
  line.className = className
  line.textContent = `${time} ${message}`
  log.prepend(line)
}

map.on('idle', () => {
  const frame = roadLayer.lastFrame
  if (!frame) return
  const hits = frame.events.filter((event) => event.hit).length
  const misses = frame.events.length - hits
  if (misses > 0) {
    appendCacheLog(`重建 ${misses} 个瓦片，命中 ${hits} 个`, 'miss')
  } else if (hits > 0) {
    appendCacheLog(`视口恢复：${hits} 个瓦片全部命中缓存`, 'hit')
  }
  updateCacheHud()
})
