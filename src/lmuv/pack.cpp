#include "lmuv/pack.h"
#include <algorithm>
#include <limits>

namespace lmuv {

namespace {

struct Rect { int x0, y0, x1, y1; };

bool fits(const Rect& r, int w, int h) {
  return w <= r.x1 - r.x0 && h <= r.y1 - r.y0;
}

// MaxRects best short side fit, with rectangle splitting.
class MaxRects {
public:
  MaxRects(int width, int height,
           const std::vector<std::array<int, 4>>& blocked) {
    freeRects_.push_back(Rect{0, 0, width, height});
    for (const auto& b : blocked) {
      Rect br{b[0], b[1], b[0] + b[2], b[1] + b[3]};
      std::vector<Rect> next;
      for (const Rect& fr : freeRects_) split(fr, br, next);
      freeRects_ = std::move(next);
      prune();
    }
  }

  bool place(int w, int h, bool allowRotation, Rect& chosen, bool& rotated) {
    rotated = false;
    int bestShort = std::numeric_limits<int>::max();
    int bestLong = std::numeric_limits<int>::max();
    int bestIndex = -1;
    for (int i = 0; i < static_cast<int>(freeRects_.size()); ++i) {
      const Rect& r = freeRects_[i];
      if (fits(r, w, h)) {
        int shortSide = std::min(r.x1 - r.x0 - w, r.y1 - r.y0 - h);
        int longSide = std::max(r.x1 - r.x0 - w, r.y1 - r.y0 - h);
        if (shortSide < bestShort ||
            (shortSide == bestShort && longSide < bestLong)) {
          bestShort = shortSide; bestLong = longSide; bestIndex = i;
        }
      }
      if (allowRotation && fits(r, h, w)) {
        int shortSide = std::min(r.x1 - r.x0 - h, r.y1 - r.y0 - w);
        int longSide = std::max(r.x1 - r.x0 - h, r.y1 - r.y0 - w);
        if (shortSide < bestShort ||
            (shortSide == bestShort && longSide < bestLong)) {
          bestShort = shortSide; bestLong = longSide; bestIndex = i;
          rotated = true;
        }
      }
    }
    if (bestIndex < 0) return false;
    const Rect& r = freeRects_[bestIndex];
    int pw = rotated ? h : w;
    int ph = rotated ? w : h;
    chosen = Rect{r.x0, r.y0, r.x0 + pw, r.y0 + ph};

    std::vector<Rect> next;
    for (const Rect& fr : freeRects_) split(fr, chosen, next);
    freeRects_ = std::move(next);
    prune();
    return true;
  }

private:
  std::vector<Rect> freeRects_;

  static void split(const Rect& free, const Rect& used, std::vector<Rect>& out) {
    if (used.x1 <= free.x0 || used.x0 >= free.x1 ||
        used.y1 <= free.y0 || used.y0 >= free.y1) {
      out.push_back(free);
      return;
    }
    if (used.x0 > free.x0)
      out.push_back(Rect{free.x0, free.y0, used.x0, free.y1});
    if (used.x1 < free.x1)
      out.push_back(Rect{used.x1, free.y0, free.x1, free.y1});
    if (used.y0 > free.y0)
      out.push_back(Rect{free.x0, free.y0, free.x1, used.y0});
    if (used.y1 < free.y1)
      out.push_back(Rect{free.x0, used.y1, free.x1, free.y1});
  }

  void prune() {
    std::vector<Rect> kept;
    for (int i = 0; i < static_cast<int>(freeRects_.size()); ++i) {
      bool contained = false;
      for (int j = 0; j < static_cast<int>(freeRects_.size()); ++j) {
        if (i == j) continue;
        const Rect& a = freeRects_[i];
        const Rect& b = freeRects_[j];
        if (b.x0 <= a.x0 && b.y0 <= a.y0 && b.x1 >= a.x1 && b.y1 >= a.y1) {
          contained = true;
          break;
        }
      }
      if (!contained) kept.push_back(freeRects_[i]);
    }
    freeRects_ = std::move(kept);
  }
};

} // namespace

PackResult packIslands(std::vector<UVIsland*>& islands,
                       const std::vector<std::array<int, 4>>& blocked,
                       const Config& cfg) {
  PackResult result;
  const int size = cfg.lightmapSize;
  const double density = cfg.texelDensity;
  // Each rectangle keeps the full padding on every side. Two neighbouring
  // rectangles therefore leave a full `padding` texel gap between their
  // content polygons, and the atlas border gets the same full gap.
  const int pad = static_cast<int>(std::ceil(cfg.padding));

  struct Job {
    UVIsland* island;
    int cw, ch;  // content size in texels
    int rw, rh;  // inflated rectangle size in texels
  };
  std::vector<Job> jobs;
  for (UVIsland* island : islands) {
    Vec2 mn{std::numeric_limits<double>::max(),
            std::numeric_limits<double>::max()};
    Vec2 mx{-std::numeric_limits<double>::max(),
            -std::numeric_limits<double>::max()};
    for (const Vec2& uv : island->localUv) {
      mn.x = std::min(mn.x, uv.x); mn.y = std::min(mn.y, uv.y);
      mx.x = std::max(mx.x, uv.x); mx.y = std::max(mx.y, uv.y);
    }
    int cw = std::max(1, static_cast<int>(std::ceil((mx.x - mn.x) * density)));
    int ch = std::max(1, static_cast<int>(std::ceil((mx.y - mn.y) * density)));
    Job job{island, cw, ch, cw + 2 * pad, ch + 2 * pad};
    if (job.rw > size || job.rh > size) {
      result.error = "island of part " +
                     std::to_string(island->partIndex) +
                     " is larger than the lightmap even without padding";
      return result;
    }
    jobs.push_back(job);
  }

  // Largest content first improves MaxRects fill.
  std::vector<int> order(jobs.size());
  for (int i = 0; i < static_cast<int>(jobs.size()); ++i) order[i] = i;
  std::sort(order.begin(), order.end(), [&](int a, int b) {
    return static_cast<long long>(jobs[a].cw) * jobs[a].ch >
           static_cast<long long>(jobs[b].cw) * jobs[b].ch;
  });

  MaxRects bin(size, size, blocked);
  for (int idx : order) {
    Job& job = jobs[idx];
    Rect chosen;
    bool rotated = false;
    if (!bin.place(job.rw, job.rh, cfg.allowRotation, chosen, rotated)) {
      result.error = "no free space left for island of part index " +
                     std::to_string(job.island->partIndex) +
                     " (requested " + std::to_string(job.rw) + "x" +
                     std::to_string(job.rh) + " texels)";
      return result;
    }
    PackedIsland placement;
    placement.island = job.island;
    placement.partIndex = job.island->partIndex;
    placement.rotated = rotated;
    placement.x = chosen.x0;
    placement.y = chosen.y0;
    placement.width = chosen.x1 - chosen.x0;
    placement.height = chosen.y1 - chosen.y0;
    result.placed.push_back(placement);
  }
  result.ok = true;
  return result;
}

Vec2 mapUv(const UVIsland& island, const PackedIsland& placement,
           const Vec2& localUv, const Config& cfg) {
  Vec2 mn{std::numeric_limits<double>::max(),
          std::numeric_limits<double>::max()};
  Vec2 mx{-std::numeric_limits<double>::max(),
          -std::numeric_limits<double>::max()};
  for (const Vec2& uv : island.localUv) {
    mn.x = std::min(mn.x, uv.x); mn.y = std::min(mn.y, uv.y);
    mx.x = std::max(mx.x, uv.x); mx.y = std::max(mx.y, uv.y);
  }
  const double density = cfg.texelDensity;
  const int pad = static_cast<int>(std::ceil(cfg.padding));
  double lx = (localUv.x - mn.x) * density;
  double ly = (localUv.y - mn.y) * density;
  if (placement.rotated) {
    // 90 degree CCW rotation inside the (swapped) content rectangle.
    double contentHeight = (mx.y - mn.y) * density;
    double oldX = lx;
    lx = contentHeight - ly;
    ly = oldX;
  }
  double px = placement.x + pad + lx;
  double py = placement.y + pad + ly;
  return {px / cfg.lightmapSize, py / cfg.lightmapSize};
}

} // namespace lmuv
