#include "mesher.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>

namespace {

// Cube corner offsets, standard numbering:
//   c0..c3 bottom (z), c4..c7 top, CCW when seen from +z / outside.
const int kCorner[8][3] = {
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
    {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1}};

// 12 edges as corner pairs.
const int kEdge[12][2] = {
    {0, 1}, {1, 2}, {3, 2}, {0, 3},  // bottom
    {4, 5}, {5, 6}, {7, 6}, {4, 7},  // top
    {0, 4}, {1, 5}, {2, 6}, {3, 7}}; // verticals

// Edge -> (min-corner offset, axis 0/1/2) for global edge identity.
const int kEdgeMin[12][3] = {
    {0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {0, 0, 0},
    {0, 0, 1}, {1, 0, 1}, {0, 1, 1}, {0, 0, 1},
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0}};
const int kEdgeAxis[12] = {0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2};

// 6 faces: 4 corners in cyclic order + the 4 cube edges between them
// (face edge m connects corner m to corner m+1).
const int kFaceCorner[6][4] = {
    {0, 1, 2, 3},  // z = 0
    {4, 5, 6, 7},  // z = 1
    {0, 1, 5, 4},  // y = 0
    {3, 2, 6, 7},  // y = 1
    {0, 3, 7, 4},  // x = 0
    {1, 2, 6, 5}}; // x = 1
const int kFaceEdge[6][4] = {
    {0, 1, 2, 3},
    {4, 5, 6, 7},
    {0, 9, 4, 8},
    {2, 10, 6, 11},
    {3, 11, 7, 8},
    {1, 10, 5, 9}};

}  // namespace

// Global id of the grid edge starting at sample (i,j,k) along `axis`.
static uint64_t edgeKey(const Grid& g, int i, int j, int k, int axis) {
  size_t pt = (static_cast<size_t>(k) * g.ny + j) * g.nx + i;
  return static_cast<uint64_t>(pt) * 3 + axis;
}

uint32_t Mesher::edgeVertex(int i, int j, int k, int axis) {
  uint64_t key = edgeKey(grid_, i, j, k, axis);
  auto it = edgeVert_.find(key);
  if (it != edgeVert_.end()) return it->second;

  int di = axis == 0, dj = axis == 1, dk = axis == 2;
  double v0 = grid_.at(i, j, k);
  double v1 = grid_.at(i + di, j + dj, k + dk);
  double t = (iso_ - v0) / (v1 - v0);
  Vec3 p = lerp(grid_.pos(i, j, k), grid_.pos(i + di, j + dj, k + dk), t);
  uint32_t id = mesh_.addVertex(p);
  edgeVert_[key] = id;
  return id;
}

void Mesher::processChunk(int i0, int i1, int j0, int j1, int k0, int k1) {
  for (int k = k0; k < k1; ++k)
    for (int j = j0; j < j1; ++j)
      for (int i = i0; i < i1; ++i) processCube(i, j, k);
}

IndexedMesh meshGrid(const Grid& g, double iso, int cx, int cy, int cz) {
  Mesher m(g, iso);
  int nx = g.nx - 1, ny = g.ny - 1, nz = g.nz - 1;
  auto split = [](int n, int c, int idx) {
    int base = n / c, rem = n % c;
    int lo = idx * base + std::min(idx, rem);
    int hi = lo + base + (idx < rem ? 1 : 0);
    return std::pair<int, int>{lo, hi};
  };
  for (int ck = 0; ck < cz; ++ck)
    for (int cj = 0; cj < cy; ++cj)
      for (int ci = 0; ci < cx; ++ci) {
        auto xr = split(nx, cx, ci);
        auto yr = split(ny, cy, cj);
        auto zr = split(nz, cz, ck);
        m.processChunk(xr.first, xr.second, yr.first, yr.second, zr.first,
                       zr.second);
      }
  return m.takeMesh();
}

void Mesher::processCube(int i, int j, int k) {
  double v[8];
  bool in[8];
  int inCount = 0;
  for (int c = 0; c < 8; ++c) {
    v[c] = grid_.at(i + kCorner[c][0], j + kCorner[c][1], k + kCorner[c][2]);
    in[c] = v[c] >= iso_;
    inCount += in[c] ? 1 : 0;
  }
  if (inCount == 0 || inCount == 8) return;

  // Intersection point on each crossed cube edge, identified by its
  // global grid-edge key so everything below is independent of the
  // order in which cubes/chunks create mesh vertices.
  uint64_t ek[12];
  bool hasEv[12];
  for (int e = 0; e < 12; ++e) {
    hasEv[e] = in[kEdge[e][0]] != in[kEdge[e][1]];
    if (hasEv[e]) {
      ek[e] = edgeKey(grid_, i + kEdgeMin[e][0], j + kEdgeMin[e][1],
                      k + kEdgeMin[e][2], kEdgeAxis[e]);
      edgeVertex(i + kEdgeMin[e][0], j + kEdgeMin[e][1], k + kEdgeMin[e][2],
                 kEdgeAxis[e]);
    }
  }

  // Face contour segments. Each segment is a pair of edge-vertex ids.
  // Connectivity on a 4-crossing (saddle) face is decided by the
  // asymptotic decider, which depends only on the 4 shared corner
  // values, so the neighboring cube always makes the same choice.
  std::vector<std::pair<uint64_t, uint64_t>> segs;
  for (int f = 0; f < 6; ++f) {
    int cross[4];
    int nc = 0;
    for (int m = 0; m < 4; ++m) {
      int e = kFaceEdge[f][m];
      if (hasEv[e]) cross[nc++] = m;
    }
    if (nc == 0) continue;
    if (nc == 2) {
      segs.emplace_back(ek[kFaceEdge[f][cross[0]]],
                        ek[kFaceEdge[f][cross[1]]]);
      continue;
    }
    // Saddle face: all 4 edges crossed. Bilinear saddle value:
    //   S = A - (B-A)(D-A) / (A - B + C - D)
    // If S > iso the super-level set {f >= iso} is connected on the
    // face, so the segments cut off the below-iso corners, and vice
    // versa. Pairing X isolates corners 1 and 3, pairing Y corners
    // 0 and 2.
    double A = v[kFaceCorner[f][0]], B = v[kFaceCorner[f][1]];
    double C = v[kFaceCorner[f][2]], D = v[kFaceCorner[f][3]];
    double delta = A - B + C - D;
    double S = (delta != 0.0) ? A - (B - A) * (D - A) / delta
                              : std::numeric_limits<double>::infinity();
    bool corner1In = in[kFaceCorner[f][1]];
    bool pairX = (S > iso_) == !corner1In;
    uint64_t p0 = ek[kFaceEdge[f][0]], p1 = ek[kFaceEdge[f][1]];
    uint64_t p2 = ek[kFaceEdge[f][2]], p3 = ek[kFaceEdge[f][3]];
    if (pairX) {
      segs.emplace_back(p0, p1);
      segs.emplace_back(p2, p3);
    } else {
      segs.emplace_back(p1, p2);
      segs.emplace_back(p3, p0);
    }
  }
  if (segs.empty()) return;

  // Link segments into closed loops on the cube boundary. Every edge
  // vertex lies on exactly 2 faces of the cube, hence has degree 2.
  std::map<uint64_t, std::vector<uint64_t>> adj;
  for (auto& s : segs) {
    adj[s.first].push_back(s.second);
    adj[s.second].push_back(s.first);
  }
  size_t cubeId =
      (static_cast<size_t>(k) * (grid_.ny - 1) + j) * (grid_.nx - 1) + i;
  int loopIdx = 0;
  std::map<uint64_t, char> visited;
  for (auto& kv : adj) {
    if (visited.count(kv.first)) continue;
    // Walk the loop.
    std::vector<uint64_t> loop;
    uint64_t start = kv.first;
    uint64_t prev = UINT64_MAX, cur = start;
    do {
      visited[cur] = 1;
      loop.push_back(cur);
      uint64_t next = adj[cur][0] != prev ? adj[cur][0] : adj[cur][1];
      prev = cur;
      cur = next;
    } while (cur != start);
    if (loop.size() < 3) continue;

    // Centroid fan vertex, keyed by (cube, loop) for global identity.
    Vec3 cent{0, 0, 0};
    for (uint64_t q : loop) cent = cent + mesh_.vertices[edgeVert_[q]];
    cent = cent * (1.0 / loop.size());
    uint64_t ckey = static_cast<uint64_t>(cubeId) * 16 + loopIdx++;
    auto cit = centVert_.find(ckey);
    uint32_t cid;
    if (cit != centVert_.end()) {
      cid = cit->second;
    } else {
      cid = mesh_.addVertex(cent);
      centVert_[ckey] = cid;
    }

    // Orient the fan so its normal points toward increasing field
    // (gradient estimated from cube corners).
    Vec3 n{0, 0, 0};
    for (size_t m = 0; m < loop.size(); ++m) {
      Vec3 a = mesh_.vertices[edgeVert_[loop[m]]] - cent;
      Vec3 b = mesh_.vertices[edgeVert_[loop[(m + 1) % loop.size()]]] - cent;
      n = n + cross(a, b);
    }
    Vec3 grad{
        (v[1] + v[2] + v[5] + v[6] - v[0] - v[3] - v[4] - v[7]) /
            (4.0 * grid_.spacing.x),
        (v[2] + v[3] + v[6] + v[7] - v[0] - v[1] - v[4] - v[5]) /
            (4.0 * grid_.spacing.y),
        (v[4] + v[5] + v[6] + v[7] - v[0] - v[1] - v[2] - v[3]) /
            (4.0 * grid_.spacing.z)};
    if (dot(n, grad) < 0.0) std::reverse(loop.begin(), loop.end());

    for (size_t m = 0; m < loop.size(); ++m)
      mesh_.addTri(cid, edgeVert_[loop[m]],
                   edgeVert_[loop[(m + 1) % loop.size()]]);
  }
}
