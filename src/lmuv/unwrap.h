#pragma once
#include "lmuv/island.h"

namespace lmuv {

struct UnwrapStats {
  int cgIterations = 0;
  double cgResidual = 0.0;
  double meanDistortion = 0.0;   // mean |sigmaMax/sigmaMin - 1|
  double maxDistortion = 0.0;
  double signedUvArea = 0.0;
  bool flipped = false;
};

// Fills island.localUv with coordinates in world units (1 UV unit = 1 world
// unit at the requested density), normalized so min(u,v) == 0.
UnwrapStats unwrapIsland(UVIsland& island);

} // namespace lmuv
