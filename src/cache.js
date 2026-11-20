// 图层瓦片缓存：键为方案 id + 瓦片坐标，值为细分网格（浏览器侧再包装 GL 资源）。
// 拖动视口后瓦片重新进入可视区时直接命中缓存，不重新切割/细分。

export class TileCache {
  constructor(buildMesh) {
    this.buildMesh = buildMesh
    this.entries = new Map()
    this.hits = 0
    this.misses = 0
    this.evictions = 0
    this.rebuilds = 0
  }

  get(tile, scaleKey) {
    const existing = this.entries.get(tile.key)
    if (existing && existing.scaleKey !== scaleKey) {
      this.entries.delete(tile.key)
      this.rebuilds += 1
    } else if (existing) {
      this.hits += 1
      existing.lastAccess = Date.now()
      return { mesh: existing.mesh, hit: true }
    }
    this.misses += 1
    const mesh = this.buildMesh(tile, scaleKey)
    this.entries.set(tile.key, { mesh, tile, scaleKey, lastAccess: Date.now() })
    return { mesh, hit: false }
  }

  has(key) {
    return this.entries.has(key)
  }

  clear() {
    const count = this.entries.size
    this.entries.clear()
    this.evictions += count
    return count
  }

  stats() {
    const requests = this.hits + this.misses
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      rebuilds: this.rebuilds,
      hitRate: requests === 0 ? 0 : this.hits / requests
    }
  }
}
