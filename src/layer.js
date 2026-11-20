// MapLibre 自定义层（WebGL1）：从两套瓦片网格按当前方案取数据，
// 中心线顶点位置不变，描边半宽在屏幕空间按像素偏移，
// 因此任意缩放级别道路宽度恒定，且瓦片边界不会产生几何缝隙。

import { GUARD, tileNetwork } from './tiling.js'
import { tessellateTile, VERTEX_FLOATS } from './tessellate.js'
import { TileCache } from './cache.js'

const VERT = `
attribute vec2 a_center;
attribute vec2 a_normal;
attribute float a_halfWidth;
attribute float a_layer;
attribute vec4 a_color;
uniform mat4 u_matrix;
varying vec4 v_color;
void main() {
  // halfWidth 已按当前缩放换算为 Mercator 世界单位，普通投影即可；
  // 几何在瓦片边界两侧使用相同公式，缩放时不会出现缝隙。
  vec2 world = a_center + a_normal * a_halfWidth;
  gl_Position = u_matrix * vec4(world, 0.0, 1.0);
  v_color = a_color + vec4(a_layer * 0.0);
}`

const FRAG = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }
  return shader
}

export class RoadLayer {
  constructor(id, network, schemes) {
    this.id = id
    this.type = 'custom'
    this.renderingMode = '2d'
    this.network = network
    this.schemes = schemes
    this.activeScheme = schemes[0].id
    this.showBoundaries = true
    this.caches = new Map()
    this.glResources = new Map()
    this.frameLog = []
  }

  onAdd(map, gl) {
    this.map = map
    this.gl = gl
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program))
    }
    this.program = program
    this.locations = {
      center: gl.getAttribLocation(program, 'a_center'),
      normal: gl.getAttribLocation(program, 'a_normal'),
      halfWidth: gl.getAttribLocation(program, 'a_halfWidth'),
      layer: gl.getAttribLocation(program, 'a_layer'),
      color: gl.getAttribLocation(program, 'a_color'),
      matrix: gl.getUniformLocation(program, 'u_matrix')
    }
    for (const scheme of this.schemes) {
      this.caches.set(scheme.id, new TileCache((tile, pixelToMerc) =>
        tessellateTile(tile, pixelToMerc)))
    }
    this.tiled = new Map(this.schemes.map((scheme) => [
      scheme.id, tileNetwork(scheme, this.network)
    ]))
  }

  setScheme(id) {
    this.activeScheme = id
    this.map.triggerRepaint()
  }

  setShowBoundaries(value) {
    this.showBoundaries = value
    this.map.triggerRepaint()
  }

  clearCaches() {
    const gl = this.gl
    for (const resources of this.glResources.values()) {
      gl.deleteBuffer(resources.vbo)
      gl.deleteBuffer(resources.ibo)
    }
    this.glResources.clear()
    for (const cache of this.caches.values()) cache.clear()
    this.map.triggerRepaint()
  }

  visibleTiles() {
    const schemeId = this.activeScheme
    const scheme = this.schemes.find((item) => item.id === schemeId)
    const bounds = this.map.getBounds()
    const north = bounds.getNorth()
    const south = bounds.getSouth()
    const west = bounds.getWest()
    const east = bounds.getEast()
    const merc = (lon, lat) => {
      const x = lon / 360 + 0.5
      const s = Math.sin((lat * Math.PI) / 180)
      const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
      return [x, y]
    }
    const [minX, maxY] = merc(west, north)
    const [maxX, minY] = merc(east, south)
    const expanded = {
      minX: minX - GUARD, minY: minY - GUARD,
      maxX: maxX + GUARD, maxY: maxY + GUARD
    }
    const { tiles } = this.tiled.get(schemeId)
    return {
      schemeId,
      scheme,
      tiles: tiles.filter((tile) => (
        tile.clip.maxX >= expanded.minX && tile.clip.minX <= expanded.maxX &&
        tile.clip.maxY >= expanded.minY && tile.clip.minY <= expanded.maxY
      ))
    }
  }

  upload(tileKey, mesh, scaleKey) {
    const gl = this.gl
    let resources = this.glResources.get(tileKey)
    if (resources && resources.scaleKey === scaleKey) return resources
    if (resources) {
      gl.deleteBuffer(resources.vbo)
      gl.deleteBuffer(resources.ibo)
    }
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW)
    const ibo = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW)
    resources = { vbo, ibo, count: mesh.indices.length, scaleKey }
    this.glResources.set(tileKey, resources)
    return resources
  }

  render(gl, matrix) {
    this.lastMatrix = matrix.slice()
    const { tiles, schemeId } = this.visibleTiles()
    const cache = this.caches.get(schemeId)
    const events = []
    const pixelToMerc = 1 / this.map.transform.worldSize
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.locations.matrix, false, matrix)

    for (const tile of tiles) {
      const { mesh, hit } = cache.get(tile, pixelToMerc)
      events.push({ key: tile.key, hit })
      const resources = this.upload(`${schemeId}:${tile.key}`, mesh, pixelToMerc)
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.vbo)
      const stride = VERTEX_FLOATS * 4
      gl.enableVertexAttribArray(this.locations.center)
      gl.vertexAttribPointer(this.locations.center, 2, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(this.locations.normal)
      gl.vertexAttribPointer(this.locations.normal, 2, gl.FLOAT, false, stride, 8)
      gl.enableVertexAttribArray(this.locations.halfWidth)
      gl.vertexAttribPointer(this.locations.halfWidth, 1, gl.FLOAT, false, stride, 16)
      gl.enableVertexAttribArray(this.locations.layer)
      gl.vertexAttribPointer(this.locations.layer, 1, gl.FLOAT, false, stride, 20)
      gl.enableVertexAttribArray(this.locations.color)
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, stride, 24)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.ibo)
      gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0)
    }
    this.lastFrame = { events, stats: cache.stats() }
    this.frameLog.push({ at: Date.now(), ...this.lastFrame })
    if (this.frameLog.length > 50) this.frameLog.shift()
  }
}
