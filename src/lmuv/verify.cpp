#include "lmuv/verify.h"
#include <algorithm>
#include <limits>
#include <cmath>

namespace lmuv {

namespace {

double segmentDistance(Vec2 a, Vec2 b, Vec2 c, Vec2 d) {
  auto pointSeg = [](Vec2 p, Vec2 s0, Vec2 s1) {
    Vec2 d = s1 - s0;
    double t = dot(p - s0, d);
    double l2 = dot(d, d);
    if (l2 > 1e-24) t = std::clamp(t / l2, 0.0, 1.0);
    else t = 0.0;
    Vec2 q = s0 + d * t;
    return dist(p, q);
  };
  return std::min({pointSeg(a, c, d), pointSeg(b, c, d),
                   pointSeg(c, a, b), pointSeg(d, a, b)});
}

struct Poly {
  std::vector<Vec2> points;  // texel space, closed implicitly
  int partIndex = -1;
};

double polygonDistance(const Poly& a, const Poly& b) {
  double best = std::numeric_limits<double>::max();
  for (size_t i = 0; i < a.points.size(); ++i) {
    Vec2 p0 = a.points[i];
    Vec2 p1 = a.points[(i + 1) % a.points.size()];
    for (size_t j = 0; j < b.points.size(); ++j) {
      Vec2 q0 = b.points[j];
      Vec2 q1 = b.points[(j + 1) % b.points.size()];
      best = std::min(best, segmentDistance(p0, p1, q0, q1));
    }
  }
  return best;
}

} // namespace

VerifyReport verifyLayout(const Scene& scene,
                          const std::vector<BuiltPart>& built) {
  VerifyReport report;
  report.requiredPadding = scene.config.padding;
  const double lm = scene.config.lightmapSize;

  std::vector<Poly> polys;
  double densitySum = 0.0;
  int densityCount = 0;
  double distortionSum = 0.0;
  int distortionCount = 0;

  for (const BuiltPart& bp : built) {
    const MeshPart& part = scene.parts[bp.partIndex];
    const FinalUv& fuv = bp.finalUv;

    for (size_t fi = 0; fi < fuv.cornerUv.size(); ++fi) {
      for (int c = 0; c < 3; ++c) {
        if (!fuv.cornerTouched[fi * 3 + c]) continue;
        const Vec2& uv = fuv.cornerUv[fi][c];
        double tx = uv.x * lm, ty = uv.y * lm;
        if (tx < 0.0 || ty < 0.0 || tx > lm || ty > lm) {
          report.insideBounds = false;
          report.valid = false;
          report.errors.push_back(part.name + ": corner UV outside [0,1]");
        }
        report.minBorderGap = std::min(report.minBorderGap,
                                       std::min({tx, ty, lm - tx, lm - ty}));
      }
    }

    for (const UnwrapStats& s : bp.unwrapStats) {
      distortionSum += s.meanDistortion;
      distortionCount += 1;
      report.maxDistortion = std::max(report.maxDistortion, s.maxDistortion);
    }

    // Per triangle texel density: texel area / world area.
    for (size_t fi = 0; fi < part.tris.size(); ++fi) {
      const auto& tri = part.tris[fi];
      if (!fuv.cornerTouched[fi * 3] ||
          !fuv.cornerTouched[fi * 3 + 1] ||
          !fuv.cornerTouched[fi * 3 + 2])
        continue;
      double wa = triangleArea(part, tri);
      if (wa < 1e-18) continue;
      Vec2 a = fuv.cornerUv[fi][0], b = fuv.cornerUv[fi][1],
            c = fuv.cornerUv[fi][2];
      double ua = 0.5 * std::abs((b.x - a.x) * (c.y - a.y) -
                                 (b.y - a.y) * (c.x - a.x));
      double texelArea = ua * lm * lm;
      double density = std::sqrt(texelArea / wa);
      if (densityCount == 0)
        report.minTexelDensity = report.maxTexelDensity = density;
      report.minTexelDensity = std::min(report.minTexelDensity, density);
      report.maxTexelDensity = std::max(report.maxTexelDensity, density);
      densitySum += density;
      densityCount += 1;
    }

    // Island boundary polygons in texel space.
    for (size_t ii = 0; ii < bp.islands.size(); ++ii) {
      const UVIsland& island = bp.islands[ii];
      const PackedIsland& place = bp.placements[ii];
      Poly poly;
      poly.partIndex = bp.partIndex;
      for (int localV = 0; localV < static_cast<int>(island.localUv.size());
           ++localV) {
        Vec2 finalUv = mapUv(island, place, island.localUv[localV],
                             scene.config);
        poly.points.push_back({finalUv.x * lm, finalUv.y * lm});
      }
      polys.push_back(std::move(poly));
    }

    // Untouched parts keep their previous UV: contribute a polygon built from
    // their corner UVs so local-update gap checks cover the whole atlas.
    if (bp.islands.empty() && !bp.finalUv.cornerUv.empty()) {
      Poly poly;
      poly.partIndex = bp.partIndex;
      std::vector<Vec2> seen;
      for (const auto& triUv : bp.finalUv.cornerUv) {
        for (const Vec2& uv : triUv) {
          Vec2 texel{uv.x * lm, uv.y * lm};
          bool duplicate = false;
          for (const Vec2& s : seen)
            if (dist(s, texel) < 1e-9) { duplicate = true; break; }
          if (!duplicate) seen.push_back(texel);
        }
      }
      poly.points = std::move(seen);
      polys.push_back(std::move(poly));
    }
  }

  report.meanDistortion = distortionCount ?
                          distortionSum / distortionCount : 0.0;

  // Polygon gap checks across every island in the shared atlas. Packing uses
  // inflated rectangles, so this distance is the final geometric evidence.
  for (size_t i = 0; i < polys.size(); ++i) {
    for (size_t j = i + 1; j < polys.size(); ++j) {
      report.minIslandGap = std::min(report.minIslandGap,
                                     polygonDistance(polys[i], polys[j]));
    }
  }
  // With zero or one polygon there is no inter-island constraint to violate.
  if (polys.size() < 2) {
    report.minIslandGap = -1.0;  // sentinel: not applicable
  } else if (report.minIslandGap + 1e-6 < report.requiredPadding) {
    report.valid = false;
    report.errors.push_back(
        "island padding violated: min gap " +
        std::to_string(report.minIslandGap) + " < required " +
        std::to_string(report.requiredPadding));
  }
  if (report.minBorderGap + 1e-6 < report.requiredPadding) {
    report.valid = false;
    report.errors.push_back(
        "border padding violated: min gap " +
        std::to_string(report.minBorderGap) + " < required " +
        std::to_string(report.requiredPadding));
  }
  return report;
}

} // namespace lmuv
