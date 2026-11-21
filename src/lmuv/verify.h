#pragma once
#include "lmuv/mesh.h"
#include "lmuv/pack.h"
#include "lmuv/island.h"
#include "lmuv/unwrap.h"

namespace lmuv {

struct FinalUv {
  int partIndex = -1;
  std::vector<Vec2> uv;       // indexed by part vertex id
  std::vector<char> touched;  // true for vertices assigned by this rebuild
  // Per-corner UV, indexed [triangle][corner]. Lightmap UVs split vertices at
  // hard edges and seams, so a welded 3D vertex can carry several UVs.
  std::vector<std::array<Vec2, 3>> cornerUv;
  std::vector<char> cornerTouched;
};

struct VerifyReport {
  bool valid = true;
  bool insideBounds = true;
  double minBorderGap = 1e300;   // texels
  double minIslandGap = 1e300;   // texels (polygon distance, same part only)
  double requiredPadding = 0.0;
  double meanDistortion = 0.0;
  double maxDistortion = 0.0;
  double minTexelDensity = 1e300;
  double maxTexelDensity = 1e300;
  std::vector<std::string> errors;
};

struct BuiltPart {
  int partIndex = -1;
  std::vector<UVIsland> islands;
  std::vector<PackedIsland> placements;
  std::vector<UnwrapStats> unwrapStats;
  FinalUv finalUv;
  bool rebuilt = true;
};

VerifyReport verifyLayout(const Scene& scene,
                          const std::vector<BuiltPart>& built);

} // namespace lmuv
