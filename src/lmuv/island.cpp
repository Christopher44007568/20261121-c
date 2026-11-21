#include "lmuv/island.h"
#include <queue>
#include <set>

namespace lmuv {

IslandResult buildIslands(const MeshPart& part, const Config& cfg) {
  IslandResult result;
  auto& edges = result.edges;

  for (int fi = 0; fi < static_cast<int>(part.tris.size()); ++fi) {
    const auto& tri = part.tris[fi];
    for (int k = 0; k < 3; ++k) {
      EdgeKey key = edgeKey(tri[k], tri[(k + 1) % 3]);
      edges[key].faces.push_back(fi);
    }
  }

  std::set<EdgeKey> forced;
  for (EdgeKey e : part.seams) forced.insert(e);
  for (EdgeKey e : part.hardEdges) forced.insert(e);

  const double angleLimit = cfg.hardAngleDeg * M_PI / 180.0;
  for (auto& kv : edges) {
    EdgeInfo& info = kv.second;
    if (info.faces.size() == 2) {
      Vec3 n0 = faceNormal(part, part.tris[info.faces[0]]);
      Vec3 n1 = faceNormal(part, part.tris[info.faces[1]]);
      double d = dot(n0, n1);
      d = std::max(-1.0, std::min(1.0, d));
      info.dihedralDeg = std::acos(d) * 180.0 / M_PI;
      info.cut = info.dihedralDeg >= cfg.hardAngleDeg - 1e-9 ||
                 angleLimit <= 1e-9;
    } else if (info.faces.size() > 2) {
      info.nonManifold = true;
      info.cut = true;
    }
    if (forced.count(kv.first)) info.cut = true;
    if (info.cut) result.cutEdges.push_back(kv.first);
  }

  std::vector<std::vector<int>> adjacency(part.tris.size());
  for (const auto& kv : edges) {
    const EdgeInfo& info = kv.second;
    if (info.cut || info.faces.size() != 2) continue;
    int a = info.faces[0], b = info.faces[1];
    adjacency[a].push_back(b);
    adjacency[b].push_back(a);
  }

  std::vector<int> component(part.tris.size(), -1);
  for (int seed = 0; seed < static_cast<int>(part.tris.size()); ++seed) {
    if (component[seed] != -1) continue;
    int id = static_cast<int>(result.islands.size());
    UVIsland island;
    island.partIndex = -1;
    std::queue<int> q;
    q.push(seed);
    component[seed] = id;
    while (!q.empty()) {
      int fi = q.front();
      q.pop();
      island.faces.push_back(fi);
      for (int nb : adjacency[fi]) {
        if (component[nb] == -1) {
          component[nb] = id;
          q.push(nb);
        }
      }
    }

    for (int fi : island.faces) {
      const auto& tri = part.tris[fi];
      island.worldArea += triangleArea(part, tri);
      for (int vi : tri) {
        if (!island.localId.count(vi)) {
          int local = static_cast<int>(island.localPos.size());
          island.localId[vi] = local;
          island.verts.push_back(vi);
          island.localPos.push_back(part.world[vi]);
        }
      }
    }
    island.localTris.reserve(island.faces.size());
    for (int fi : island.faces) {
      const auto& tri = part.tris[fi];
      island.localTris.push_back({
        island.localId[tri[0]], island.localId[tri[1]], island.localId[tri[2]]});
    }
    result.islands.push_back(std::move(island));
  }

  for (auto& island : result.islands) island.partIndex = -1;
  return result;
}

} // namespace lmuv
