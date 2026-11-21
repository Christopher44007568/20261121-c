#pragma once
#include "lmuv/mesh.h"
#include "lmuv/island.h"

namespace lmuv {

struct PackedIsland {
  UVIsland* island = nullptr;
  int partIndex = -1;
  bool rotated = false;
  int x = 0;          // rectangle origin in texels
  int y = 0;
  int width = 0;      // inflated rectangle size in texels
  int height = 0;
};

struct PackResult {
  bool ok = false;
  std::string error;
  std::vector<PackedIsland> placed;
};

// Free-rectangle bin packer. `blocked` rectangles are occupied regions that
// must be avoided (used by local updates). Sizes are integer texels.
PackResult packIslands(std::vector<UVIsland*>& islands,
                       const std::vector<std::array<int, 4>>& blocked,
                       const Config& cfg);

// Convert an island's local UV (world units, origin at 0) to final [0,1] UV
// using its packing placement.
Vec2 mapUv(const UVIsland& island, const PackedIsland& placement,
           const Vec2& localUv, const Config& cfg);

} // namespace lmuv
