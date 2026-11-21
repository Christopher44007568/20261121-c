#include "lmuv/mesh.h"
#include <fstream>
#include <sstream>

namespace lmuv {

std::string readFile(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) throw std::runtime_error("cannot read file: " + path);
  std::ostringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

void writeFile(const std::string& path, const std::string& content) {
  std::ofstream f(path, std::ios::binary);
  if (!f) throw std::runtime_error("cannot write file: " + path);
  f << content;
}

double triangleArea(const MeshPart& part, const std::array<int, 3>& tri) {
  const Vec3& a = part.world[tri[0]];
  const Vec3& b = part.world[tri[1]];
  const Vec3& c = part.world[tri[2]];
  return 0.5 * length(cross(b - a, c - a));
}

Vec3 faceNormal(const MeshPart& part, const std::array<int, 3>& tri) {
  const Vec3& a = part.world[tri[0]];
  const Vec3& b = part.world[tri[1]];
  const Vec3& c = part.world[tri[2]];
  return normalize(cross(b - a, c - a));
}

namespace {

std::vector<EdgeKey> parseEdges(const Json& j, const char* key) {
  std::vector<EdgeKey> out;
  if (!j.has(key)) return out;
  for (const Json& e : j.get(key).arr) {
    if (e.arr.size() != 2) throw JsonError("edge must be [a,b]");
    out.push_back(edgeKey(static_cast<int>(e.arr[0].num),
                          static_cast<int>(e.arr[1].num)));
  }
  return out;
}

} // namespace

Scene loadScene(const Json& root) {
  Scene scene;
  Config& cfg = scene.config;
  if (root.has("config")) {
    const Json& c = root.get("config");
    cfg.lightmapSize = c.getInt("lightmapSize", cfg.lightmapSize);
    cfg.texelDensity = c.getNumber("texelDensity", cfg.texelDensity);
    cfg.padding = c.getNumber("padding", cfg.padding);
    cfg.hardAngleDeg = c.getNumber("hardAngleDeg", cfg.hardAngleDeg);
    cfg.allowRotation = c.getBool("allowRotation", cfg.allowRotation);
  }
  if (!root.has("parts")) throw JsonError("scene requires parts");

  for (const Json& pj : root.get("parts").arr) {
    MeshPart part;
    part.name = pj.getString("name");
    if (part.name.empty()) throw JsonError("part requires name");

    double sx = 1.0, sy = 1.0, sz = 1.0, tx = 0.0, ty = 0.0, tz = 0.0;
    if (pj.has("transform")) {
      const Json& t = pj.get("transform");
      if (t.has("scale")) {
        const Json& s = t.get("scale");
        if (s.arr.size() != 3) throw JsonError("scale must have 3 values");
        sx = s.arr[0].num; sy = s.arr[1].num; sz = s.arr[2].num;
      }
      if (t.has("translation")) {
        const Json& v = t.get("translation");
        if (v.arr.size() != 3) throw JsonError("translation must have 3 values");
        tx = v.arr[0].num; ty = v.arr[1].num; tz = v.arr[2].num;
      }
    }

    if (!pj.has("positions")) throw JsonError("part requires positions");
    for (const Json& v : pj.get("positions").arr) {
      if (v.arr.size() != 3) throw JsonError("position must have 3 values");
      Vec3 raw{v.arr[0].num, v.arr[1].num, v.arr[2].num};
      part.positions.push_back(raw);
      part.world.push_back({raw.x * sx + tx, raw.y * sy + ty, raw.z * sz + tz});
    }

    if (!pj.has("triangles")) throw JsonError("part requires triangles");
    for (const Json& t : pj.get("triangles").arr) {
      if (t.arr.size() != 3) throw JsonError("triangle must have 3 indices");
      part.tris.push_back({static_cast<int>(t.arr[0].num),
                           static_cast<int>(t.arr[1].num),
                           static_cast<int>(t.arr[2].num)});
    }

    if (pj.has("uv")) {
      for (const Json& uv : pj.get("uv").arr) {
        if (uv.arr.size() != 2) throw JsonError("uv must have 2 values");
        part.baseUv.push_back({uv.arr[0].num, uv.arr[1].num});
      }
      if (part.baseUv.size() != part.positions.size())
        throw JsonError("uv count must match position count in part " + part.name);
    }

    part.seams = parseEdges(pj, "seams");
    part.hardEdges = parseEdges(pj, "hardEdges");
    scene.parts.push_back(std::move(part));
  }
  return scene;
}

} // namespace lmuv
