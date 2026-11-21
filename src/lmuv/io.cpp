#include "lmuv/io.h"
#include "lmuv/island.h"
#include "lmuv/unwrap.h"
#include "lmuv/pack.h"
#include <unordered_map>
#include <set>
#include <sstream>

namespace lmuv {

namespace {

BuiltPart keepPart(int partIndex, const MeshPart& part) {
  BuiltPart bp;
  bp.partIndex = partIndex;
  bp.rebuilt = false;
  bp.finalUv.partIndex = partIndex;
  bp.finalUv.uv = part.baseUv;
  bp.finalUv.touched.assign(part.positions.size(), true);
  bp.finalUv.cornerUv.resize(part.tris.size());
  bp.finalUv.cornerTouched.assign(part.tris.size() * 3, true);
  for (size_t fi = 0; fi < part.tris.size(); ++fi)
    for (int c = 0; c < 3; ++c)
      bp.finalUv.cornerUv[fi][c] = part.baseUv[part.tris[fi][c]];
  return bp;
}

} // namespace

BuildOutput rebuild(Scene& scene, const BuildOptions& options) {
  BuildOutput output;
  try {
    std::set<int> rebuildSet;
    bool local = !options.onlyPart.empty();
    if (local) {
      bool found = false;
      for (int i = 0; i < static_cast<int>(scene.parts.size()); ++i) {
        if (scene.parts[i].name == options.onlyPart) {
          rebuildSet.insert(i);
          found = true;
        }
      }
      if (!found)
        throw std::runtime_error("part not found: " + options.onlyPart);
    } else {
      for (int i = 0; i < static_cast<int>(scene.parts.size()); ++i)
        rebuildSet.insert(i);
    }

    for (int i = 0; i < static_cast<int>(scene.parts.size()); ++i) {
      if (local && !rebuildSet.count(i)) {
        if (scene.parts[i].baseUv.empty())
          throw std::runtime_error(
              "local update requires existing UV for untouched part " +
              scene.parts[i].name);
      }
    }

    // First pass: untouched parts keep their UV exactly; rebuilt parts are
    // segmented and unwrapped without packing.
    std::vector<BuiltPart> built(scene.parts.size());
    std::vector<UVIsland*> allNewIslands;
    for (int i = 0; i < static_cast<int>(scene.parts.size()); ++i) {
      if (!rebuildSet.count(i)) {
        built[i] = keepPart(i, scene.parts[i]);
        continue;
      }
      BuiltPart& bp = built[i];
      bp.partIndex = i;
      bp.rebuilt = true;
      IslandResult ir = buildIslands(scene.parts[i], scene.config);
      bp.islands = std::move(ir.islands);
      for (UVIsland& island : bp.islands) {
        island.partIndex = i;
        bp.unwrapStats.push_back(unwrapIsland(island));
        allNewIslands.push_back(&island);
      }
    }

    std::vector<std::array<int, 4>> blocked;
    if (local) {
      const double lm = scene.config.lightmapSize;
      for (int i = 0; i < static_cast<int>(scene.parts.size()); ++i) {
        if (rebuildSet.count(i)) continue;
        const auto& uv = scene.parts[i].baseUv;
        double mnX = 1e300, mnY = 1e300, mxX = -1e300, mxY = -1e300;
        for (const Vec2& v : uv) {
          mnX = std::min(mnX, v.x); mnY = std::min(mnY, v.y);
          mxX = std::max(mxX, v.x); mxY = std::max(mxY, v.y);
        }
        int pad = static_cast<int>(std::ceil(scene.config.padding));
        int x0 = std::max(0, static_cast<int>(std::floor(mnX * lm)) - pad);
        int y0 = std::max(0, static_cast<int>(std::floor(mnY * lm)) - pad);
        int x1 = std::min(static_cast<int>(lm),
                          static_cast<int>(std::ceil(mxX * lm)) + pad);
        int y1 = std::min(static_cast<int>(lm),
                          static_cast<int>(std::ceil(mxY * lm)) + pad);
        blocked.push_back({x0, y0, x1 - x0, y1 - y0});
      }
    }

    if (!allNewIslands.empty()) {
      PackResult packed = packIslands(allNewIslands, blocked, scene.config);
      if (!packed.ok) {
        output.ok = false;
        output.error = packed.error;
        return output;
      }
      for (const PackedIsland& place : packed.placed) {
        BuiltPart& owner = built[place.partIndex];
        if (owner.placements.size() < owner.islands.size())
          owner.placements.resize(owner.islands.size());
        int islandLocal = -1;
        for (size_t k = 0; k < owner.islands.size(); ++k) {
          if (&owner.islands[k] == place.island) { islandLocal =
              static_cast<int>(k); break; }
        }
        if (islandLocal < 0)
          throw std::runtime_error("internal: packed island lookup failed");
        owner.placements[islandLocal] = place;
      }
      for (int pi : rebuildSet) {
        BuiltPart& bp = built[pi];
        MeshPart& part = scene.parts[pi];
        bp.finalUv.partIndex = pi;
        bp.finalUv.uv.resize(part.positions.size());
        bp.finalUv.touched.assign(part.positions.size(), false);
        bp.finalUv.cornerUv.resize(part.tris.size());
        bp.finalUv.cornerTouched.assign(part.tris.size() * 3, false);
        // Map each island's global vertex ids to the island-local UV.
        std::vector<std::unordered_map<int, Vec2>> islandVertexUv(
            bp.islands.size());
        for (size_t ii = 0; ii < bp.islands.size(); ++ii) {
          const UVIsland& island = bp.islands[ii];
          const PackedIsland& placement = bp.placements[ii];
          auto& vertexUv = islandVertexUv[ii];
          for (size_t li = 0; li < island.verts.size(); ++li) {
            int globalV = island.verts[li];
            Vec2 mapped =
                mapUv(island, placement, island.localUv[li], scene.config);
            vertexUv[globalV] = mapped;
            bp.finalUv.touched[globalV] = true;
          }
        }
        // Emit per-corner UV so shared welded vertices keep a distinct UV
        // for every island they belong to.
        for (size_t fi = 0; fi < part.tris.size(); ++fi) {
          for (size_t ii = 0; ii < bp.islands.size(); ++ii) {
            const UVIsland& island = bp.islands[ii];
            bool belongs = true;
            for (int gv : part.tris[fi])
              belongs = belongs && island.localId.count(gv) > 0;
            if (!belongs) continue;
            const auto& vertexUv = islandVertexUv[ii];
            for (int c = 0; c < 3; ++c) {
              int gv = part.tris[fi][c];
              bp.finalUv.cornerUv[fi][c] = vertexUv.at(gv);
              bp.finalUv.cornerTouched[fi * 3 + c] = true;
              bp.finalUv.uv[gv] = vertexUv.at(gv);
            }
            break;
          }
        }
      }
    }

    output.built = std::move(built);
    output.report = verifyLayout(scene, output.built);
    output.ok = output.report.valid;
    if (!output.ok)
      output.error = "verification failed";
  } catch (const std::exception& e) {
    output.ok = false;
    output.error = e.what();
  }
  return output;
}

namespace {

Json vec2Array(const Vec2& v) {
  Json j = Json::makeArray();
  j.arr.push_back(Json{}); j.arr.back().type = Json::Type::Number; j.arr.back().num = v.x;
  j.arr.push_back(Json{}); j.arr.back().type = Json::Type::Number; j.arr.back().num = v.y;
  return j;
}

} // namespace

Json buildOutputJson(const Scene& scene, const BuildOutput& output) {
  Json root = Json::makeObject();
  root.set("ok", [&] { Json j; j.type = Json::Type::Bool; j.b = output.ok; return j; }());
  if (!output.error.empty()) root.set("error", [&] { Json j; j.type = Json::Type::String; j.str = output.error; return j; }());
  auto appendReport = [&]() {
    const VerifyReport& r = output.report;
    Json report = Json::makeObject();
    auto num = [](double v) { Json j; j.type = Json::Type::Number; j.num = v; return j; };
    report.set("valid", [&] { Json j; j.type = Json::Type::Bool; j.b = r.valid; return j; }());
    report.set("insideBounds", [&] { Json j; j.type = Json::Type::Bool; j.b = r.insideBounds; return j; }());
    report.set("minBorderGapTexels", num(r.minBorderGap));
    report.set("minIslandGapTexels", num(r.minIslandGap));
    report.set("requiredPaddingTexels", num(r.requiredPadding));
    report.set("meanDistortion", num(r.meanDistortion));
    report.set("maxDistortion", num(r.maxDistortion));
    report.set("minTexelDensity", num(r.minTexelDensity));
    report.set("maxTexelDensity", num(r.maxTexelDensity));
    Json errs = Json::makeArray();
    for (const std::string& e : r.errors) {
      Json j; j.type = Json::Type::String; j.str = e; errs.arr.push_back(j);
    }
    report.set("errors", errs);
    root.set("report", report);
  };
  if (!output.ok) {
    appendReport();
    return root;
  }

  Json parts = Json::makeArray();
  for (const BuiltPart& bp : output.built) {
    const MeshPart& part = scene.parts[bp.partIndex];
    Json pj = Json::makeObject();
    pj.set("name", [&] { Json j; j.type = Json::Type::String; j.str = part.name; return j; }());
    pj.set("rebuilt", [&] { Json j; j.type = Json::Type::Bool; j.b = bp.rebuilt; return j; }());
    // cornerUv[t][c]: one UV per triangle corner, matching the split topology.
    Json cornerUv = Json::makeArray();
    for (const auto& triUv : bp.finalUv.cornerUv) {
      Json tri = Json::makeArray();
      for (const Vec2& v : triUv) tri.arr.push_back(vec2Array(v));
      cornerUv.arr.push_back(tri);
    }
    pj.set("cornerUv", cornerUv);

    Json islands = Json::makeArray();
    for (size_t i = 0; i < bp.islands.size(); ++i) {
      const PackedIsland& place = bp.placements[i];
      Json ij = Json::makeObject();
      ij.set("faces", [&] { Json a = Json::makeArray(); for (int f : bp.islands[i].faces) { Json n; n.type = Json::Type::Number; n.num = f; a.arr.push_back(n); } return a; }());
      Json rect = Json::makeArray();
      for (int v : {place.x, place.y, place.width, place.height}) {
        Json n; n.type = Json::Type::Number; n.num = v; rect.arr.push_back(n);
      }
      ij.set("rectTexels", rect);
      ij.set("rotated", [&] { Json j; j.type = Json::Type::Bool; j.b = place.rotated; return j; }());
      const UnwrapStats& s = bp.unwrapStats[i];
      ij.set("meanDistortion", [&] { Json j; j.type = Json::Type::Number; j.num = s.meanDistortion; return j; }());
      ij.set("maxDistortion", [&] { Json j; j.type = Json::Type::Number; j.num = s.maxDistortion; return j; }());
      islands.arr.push_back(ij);
    }
    pj.set("islands", islands);
    parts.arr.push_back(pj);
  }
  root.set("parts", parts);

  appendReport();
  return root;
}

std::string buildObj(const Scene& scene, const BuildOutput& output) {
  std::ostringstream ss;
  int vertexOffset = 1;
  for (const BuiltPart& bp : output.built) {
    const MeshPart& part = scene.parts[bp.partIndex];
    ss << "o " << part.name << "\n";
    for (const Vec3& p : part.world)
      ss << "v " << p.x << ' ' << p.y << ' ' << p.z << "\n";
    // Emit one vt per triangle corner so hard-edge/seam splits are preserved.
    int uvOffset = 0;
    for (size_t fi = 0; fi < part.tris.size(); ++fi) {
      for (int c = 0; c < 3; ++c) {
        const Vec2& uv = bp.finalUv.cornerUv[fi][c];
        ss << "vt " << uv.x << ' ' << uv.y << "\n";
      }
    }
    for (size_t fi = 0; fi < part.tris.size(); ++fi) {
      const auto& tri = part.tris[fi];
      int a = tri[0] + vertexOffset;
      int b = tri[1] + vertexOffset;
      int c = tri[2] + vertexOffset;
      int ua = uvOffset + 1, ub = uvOffset + 2, uc = uvOffset + 3;
      ss << "f " << a << '/' << ua << ' ' << b << '/' << ub << ' '
         << c << '/' << uc << "\n";
      uvOffset += 3;
    }
    vertexOffset += static_cast<int>(part.positions.size());
  }
  return ss.str();
}

} // namespace lmuv
