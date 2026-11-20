#pragma once
#include <cstdint>
#include <fstream>
#include <map>
#include <numeric>
#include <stdexcept>
#include <utility>
#include <vector>
#include "vec.hpp"

struct Tri {
  uint32_t a, b, c;
};

// Indexed triangle mesh: vertices shared by index, so cracks show up as
// boundary edges and bad stitching as non-manifold edges.
struct IndexedMesh {
  std::vector<Vec3> vertices;
  std::vector<Tri> tris;

  uint32_t addVertex(const Vec3& p) {
    vertices.push_back(p);
    return static_cast<uint32_t>(vertices.size() - 1);
  }
  void addTri(uint32_t a, uint32_t b, uint32_t c) {
    tris.push_back({a, b, c});
  }
};

struct MeshStats {
  size_t numVertices = 0;
  size_t numTris = 0;
  size_t components = 0;        // connected components (vertex union-find)
  size_t boundaryEdges = 0;     // edges with exactly 1 incident triangle
  size_t nonManifoldEdges = 0;  // edges with more than 2 incident triangles
  long euler = 0;               // V - E + F over used vertices
};

inline MeshStats computeStats(const IndexedMesh& m) {
  MeshStats s;
  s.numVertices = m.vertices.size();
  s.numTris = m.tris.size();

  // Union-find over vertices that appear in at least one triangle.
  std::vector<uint32_t> parent(m.vertices.size());
  std::iota(parent.begin(), parent.end(), 0);
  auto find = [&](uint32_t x) {
    while (parent[x] != x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  std::vector<char> used(m.vertices.size(), 0);
  std::map<std::pair<uint32_t, uint32_t>, int> edgeCount;
  auto addEdge = [&](uint32_t u, uint32_t v) {
    if (u > v) std::swap(u, v);
    edgeCount[{u, v}]++;
  };
  for (const Tri& t : m.tris) {
    used[t.a] = used[t.b] = used[t.c] = 1;
    uint32_t ra = find(t.a), rb = find(t.b), rc = find(t.c);
    if (rb != ra) parent[rb] = ra;
    if (rc != ra) parent[rc] = ra;
    addEdge(t.a, t.b);
    addEdge(t.b, t.c);
    addEdge(t.c, t.a);
  }
  size_t usedV = 0;
  std::map<uint32_t, char> roots;
  for (uint32_t i = 0; i < m.vertices.size(); ++i) {
    if (!used[i]) continue;
    ++usedV;
    roots[find(i)] = 1;
  }
  s.components = roots.size();
  for (const auto& kv : edgeCount) {
    if (kv.second == 1) ++s.boundaryEdges;
    if (kv.second > 2) ++s.nonManifoldEdges;
  }
  s.euler = static_cast<long>(usedV) - static_cast<long>(edgeCount.size()) +
            static_cast<long>(m.tris.size());
  return s;
}

inline void exportObj(const IndexedMesh& m, const std::string& path) {
  std::ofstream out(path);
  if (!out) throw std::runtime_error("cannot open " + path);
  out.precision(17);
  for (const Vec3& v : m.vertices)
    out << "v " << v.x << " " << v.y << " " << v.z << "\n";
  for (const Tri& t : m.tris)
    out << "f " << t.a + 1 << " " << t.b + 1 << " " << t.c + 1 << "\n";
}
