#pragma once
#include "lmuv/math.h"
#include "lmuv/json.h"
#include <string>
#include <vector>
#include <array>
#include <cstdint>

namespace lmuv {

using EdgeKey = uint64_t;

inline EdgeKey edgeKey(int a, int b) {
  if (a > b) std::swap(a, b);
  return (static_cast<EdgeKey>(static_cast<uint32_t>(a)) << 32) |
         static_cast<uint32_t>(b);
}
inline EdgeKey edgeKeyO(int a, int b) {
  return (static_cast<EdgeKey>(static_cast<uint32_t>(a)) << 32) |
         static_cast<uint32_t>(b);
}
inline std::pair<int, int> edgeVerts(EdgeKey k) {
  return {static_cast<int>(k >> 32), static_cast<int>(k & 0xffffffffu)};
}

struct Config {
  int lightmapSize = 1024;
  double texelDensity = 100.0;   // texels per world unit
  double padding = 4.0;          // texels
  double hardAngleDeg = 60.0;    // dihedral angle that forces a cut
  bool allowRotation = true;
};

struct MeshPart {
  std::string name;
  std::vector<Vec3> positions;   // raw (local) positions from the file
  std::vector<Vec3> world;       // positions with part transform baked in
  std::vector<std::array<int, 3>> tris;
  std::vector<Vec2> baseUv;      // existing lightmap UV (local mode keeps these)
  // explicit constraints on vertex pairs
  std::vector<EdgeKey> seams;
  std::vector<EdgeKey> hardEdges;
};

struct Scene {
  Config config;
  std::vector<MeshPart> parts;
};

Scene loadScene(const Json& root);
std::string readFile(const std::string& path);
void writeFile(const std::string& path, const std::string& content);

// Geometry helpers operating on baked (world) positions.
double triangleArea(const MeshPart& part, const std::array<int, 3>& tri);
Vec3 faceNormal(const MeshPart& part, const std::array<int, 3>& tri);

} // namespace lmuv
