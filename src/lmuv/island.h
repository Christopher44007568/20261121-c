#pragma once
#include "lmuv/mesh.h"
#include <map>
#include <unordered_map>

namespace lmuv {

struct EdgeInfo {
  std::vector<int> faces;          // triangle indices incident to this edge
  double dihedralDeg = 0.0;        // 0 for boundary / non-manifold
  bool cut = false;                // hard edge or seam: islands split here
  bool nonManifold = false;
};

struct UVIsland {
  int partIndex = -1;
  std::vector<int> faces;                 // global triangle indices in the part
  std::vector<int> verts;                 // global vertex ids used by this island
  std::unordered_map<int, int> localId;   // global id -> local id
  std::vector<Vec3> localPos;             // baked 3D positions, local order
  std::vector<std::array<int, 3>> localTris;
  std::vector<Vec2> localUv;              // produced by the unwrapper
  double worldArea = 0.0;
};

struct IslandResult {
  std::map<EdgeKey, EdgeInfo> edges;
  std::vector<EdgeKey> cutEdges;
  std::vector<UVIsland> islands;
};

IslandResult buildIslands(const MeshPart& part, const Config& cfg);

} // namespace lmuv
