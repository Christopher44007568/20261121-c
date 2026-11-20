#pragma once
#include <unordered_map>
#include "mesh.hpp"
#include "vec.hpp"

// Uniform sampled scalar grid.
struct Grid {
  int nx = 0, ny = 0, nz = 0;
  Vec3 origin, spacing;
  std::vector<double> val;

  double at(int i, int j, int k) const {
    return val[(static_cast<size_t>(k) * ny + j) * nx + i];
  }
  Vec3 pos(int i, int j, int k) const {
    return {origin.x + i * spacing.x,
            origin.y + j * spacing.y,
            origin.z + k * spacing.z};
  }
};

// Crack-free isosurface mesher.
//
// Ambiguity is resolved per shared voxel face with the asymptotic decider:
// the face contour connectivity is a pure function of the 4 face corner
// values and the iso value, so both cubes adjacent to a face always agree,
// regardless of the order or chunking in which cubes are visited.
//
// Inside each cube, the face contour segments link into closed loops on the
// cube boundary; each loop is triangulated as a fan around its centroid.
// Every shared-face segment is therefore an edge of exactly one triangle
// from each side, giving a closed, manifold, order-independent mesh.
class Mesher {
public:
  Mesher(const Grid& g, double iso) : grid_(g), iso_(iso) {}

  // Process cubes [i0,i1) x [j0,j1) x [k0,k1) (cube indices).
  void processChunk(int i0, int i1, int j0, int j1, int k0, int k1);

  IndexedMesh takeMesh() { return std::move(mesh_); }

private:
  uint32_t edgeVertex(int i, int j, int k, int axis);
  void processCube(int i, int j, int k);

  const Grid& grid_;
  double iso_;
  IndexedMesh mesh_;
  // Global vertex identity: edge vertices keyed by global grid-edge id,
  // loop-centroid vertices keyed by (cube id, loop number). Both are
  // independent of chunk boundaries and traversal order.
  std::unordered_map<uint64_t, uint32_t> edgeVert_;
  std::unordered_map<uint64_t, uint32_t> centVert_;
};

// Convenience: mesh the whole grid split into cx*cy*cz chunks.
IndexedMesh meshGrid(const Grid& g, double iso, int cx, int cy, int cz);
