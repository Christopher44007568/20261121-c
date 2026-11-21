#include "lmuv/unwrap.h"
#include <unordered_map>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <array>

namespace lmuv {

namespace {
struct SymSparse {
  int n = 0;
  std::vector<std::unordered_map<int, double>> rows;
  explicit SymSparse(int n_) : n(n_), rows(n_) {}
  void add(int r, int c, double v) {
    if (r > c) std::swap(r, c);
    rows[r][c] += v;
  }
  double diag(int i) const {
    auto it = rows[i].find(i);
    return it == rows[i].end() ? 0.0 : it->second;
  }
  // y = A x using the stored upper triangle.
  void multiply(const std::vector<double>& x, std::vector<double>& y) const {
    std::fill(y.begin(), y.end(), 0.0);
    for (int r = 0; r < n; ++r) {
      for (const auto& kv : rows[r]) {
        int c = kv.first;
        double v = kv.second;
        y[r] += v * x[c];
        if (c != r) y[c] += v * x[r];
      }
    }
  }
};

// Solve A x = b with Jacobi preconditioned CG. A is SPD (pins ensure that).
int conjugateGradient(const SymSparse& A, const std::vector<double>& b,
                      std::vector<double>& x, double tol, int maxIter,
                      double& finalResidual) {
  int n = A.n;
  std::vector<double> invDiag(n), r(n), p(n), Ap(n);
  for (int i = 0; i < n; ++i) {
    double d = A.diag(i);
    invDiag[i] = d > 1e-18 ? 1.0 / d : 1.0;
  }
  A.multiply(x, Ap);
  for (int i = 0; i < n; ++i) r[i] = b[i] - Ap[i];
  for (int i = 0; i < n; ++i) p[i] = invDiag[i] * r[i];
  double rz = 0.0;
  for (int i = 0; i < n; ++i) rz += r[i] * p[i];
  double bNorm = std::sqrt(std::inner_product(b.begin(), b.end(), b.begin(), 0.0));
  if (bNorm < 1e-18) bNorm = 1.0;

  int iter = 0;
  for (; iter < maxIter; ++iter) {
    A.multiply(p, Ap);
    double pAp = std::inner_product(p.begin(), p.end(), Ap.begin(), 0.0);
    if (pAp <= 1e-30) break;
    double alpha = rz / pAp;
    for (int i = 0; i < n; ++i) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    double residual = std::sqrt(std::inner_product(r.begin(), r.end(), r.begin(), 0.0));
    finalResidual = residual / bNorm;
    if (finalResidual < tol) { ++iter; break; }
    double rzNew = 0.0;
    for (int i = 0; i < n; ++i) rzNew += r[i] * invDiag[i] * r[i];
    double beta = rzNew / rz;
    for (int i = 0; i < n; ++i) p[i] = invDiag[i] * r[i] + beta * p[i];
    rz = rzNew;
  }
  return iter;
}

} // namespace

UnwrapStats unwrapIsland(UVIsland& island) {
  UnwrapStats stats;
  const int nv = static_cast<int>(island.localPos.size());
  const int n = nv * 2;
  const auto U = [&](int v) { return 2 * v; };
  const auto V = [&](int v) { return 2 * v + 1; };

  SymSparse A(n);
  std::vector<double> rhs(n, 0.0);

  // Per triangle build the two LSCM energy rows (real and imaginary) and
  // accumulate their outer products into the normal equations J^T J.
  for (const auto& tri : island.localTris) {
    int ids[3] = {tri[0], tri[1], tri[2]};
    const Vec3& p0 = island.localPos[ids[0]];
    const Vec3& p1 = island.localPos[ids[1]];
    const Vec3& p2 = island.localPos[ids[2]];
    Vec3 e1 = p1 - p0;
    Vec3 e2 = p2 - p0;
    double area2 = length(cross(e1, e2));
    if (area2 < 1e-18) continue;
    Vec3 xAxis = normalize(e1);
    Vec3 normal = normalize(cross(e1, e2));
    Vec3 yAxis = cross(normal, xAxis);
    auto toLocal = [&](const Vec3& e) {
      return Vec2(dot(e, xAxis), dot(e, yAxis));
    };
    Vec2 d1 = toLocal(e1);
    Vec2 d2 = toLocal(e2);
    double inv = 1.0 / area2;
    // Barycentric basis gradients in the local 2D frame. They satisfy
    // grad0 + grad1 + grad2 = 0 (partition of unity):
    //   perp(v) = (-v.y, v.x)
    //   grad1 =  perp(e2) / area2
    //   grad2 = -perp(e1) / area2
    //   grad0 = -(grad1 + grad2)
    Vec2 grad1 = Vec2(-d2.y, d2.x) * inv;
    Vec2 grad2 = Vec2(d1.y, -d1.x) * inv;
    Vec2 grad0 = (grad1 + grad2) * -1.0;
    Vec2 grad[3] = {grad0, grad1, grad2};
    double w = std::sqrt(area2 * 0.5);

    // Non-zero columns of each row: U(v) and V(v) for the three vertices.
    int colU[3] = {U(ids[0]), U(ids[1]), U(ids[2])};
    int colV[3] = {V(ids[0]), V(ids[1]), V(ids[2])};
    double realC[3], imagC[3];
    for (int a = 0; a < 3; ++a) {
      realC[a] = grad[a].x * w;   // coefficient on U
      imagC[a] = grad[a].y * w;   // coefficient on V in the imaginary row
    }
    // LSCM per triangle (Levy et al.):
    //   real energy:  g_x . u - g_y . v
    //   imag energy:  g_y . u + g_x . v
    // with g_x = grad.x (coeff on U), g_y = grad.y (coeff on V).
    double rowReal[6];
    int cols[6];
    for (int a = 0; a < 3; ++a) {
      cols[2 * a] = colU[a];
      cols[2 * a + 1] = colV[a];
      rowReal[2 * a] = realC[a];
      rowReal[2 * a + 1] = -imagC[a];
    }
    double rowImag[6];
    for (int a = 0; a < 3; ++a) {
      rowImag[2 * a] = imagC[a];
      rowImag[2 * a + 1] = realC[a];
    }
    // The normal-equations matrix is symmetric and A stores only the upper
    // triangle: feed each unordered column pair exactly once.
    for (int a = 0; a < 6; ++a) {
      for (int b = a; b < 6; ++b) {
        A.add(cols[a], cols[b],
              rowReal[a] * rowReal[b] + rowImag[a] * rowImag[b]);
      }
    }
  }

  // Two-pin LSCM. Prefer the longest boundary edge (an edge incident to a
  // single triangle): anchoring a real silhouette edge avoids the degenerate
  // diagonal pin on flat multi-triangle patches. Closed meshes have no
  // boundary edge, so fall back to the longest edge overall.
  std::unordered_map<EdgeKey, int> edgeFaceCount;
  for (const auto& tri : island.localTris) {
    for (int e = 0; e < 3; ++e)
      edgeFaceCount[edgeKey(tri[e], tri[(e + 1) % 3])]++;
  }
  int pinA = 0, pinB = 0;
  double bestBoundary = -1.0, bestAny = -1.0;
  int anyA = 0, anyB = 0;
  for (const auto& tri : island.localTris) {
    for (int e = 0; e < 3; ++e) {
      int a = tri[e], b = tri[(e + 1) % 3];
      double d2 = dot(island.localPos[a] - island.localPos[b],
                      island.localPos[a] - island.localPos[b]);
      if (d2 > bestAny) { bestAny = d2; anyA = a; anyB = b; }
      if (edgeFaceCount[edgeKey(a, b)] == 1 && d2 > bestBoundary) {
        bestBoundary = d2; pinA = a; pinB = b;
      }
    }
  }
  if (bestBoundary < 0.0) { pinA = anyA; pinB = anyB; }
  std::vector<char> pinned(n, false);
  std::array<int, 4> pinIdx = {U(pinA), V(pinA), U(pinB), V(pinB)};
  for (int idx : pinIdx) {
    pinned[idx] = true;
  }
  // Two-pin LSCM: pin A at the origin, pin B on the u axis at its true 3D
  // distance. Every other vertex is recovered by the conformal solve.
  double pinDistance = length(island.localPos[pinB] -
                              island.localPos[pinA]);
  std::vector<double> pinValue(n, 0.0);
  rhs[U(pinA)] = pinValue[U(pinA)] = 0.0;
  rhs[V(pinA)] = pinValue[V(pinA)] = 0.0;
  rhs[U(pinB)] = pinValue[U(pinB)] = pinDistance;
  rhs[V(pinB)] = pinValue[V(pinB)] = 0.0;

  // Pin via the standard elimination: zero every coupling that touches a
  // pinned DOF, keeping the (upper-triangle) storage consistent:
  //   * entry (r, c) with r pinned or c pinned must disappear,
  //   * move the pinned contribution into the free DOF right hand side,
  //   * then each pinned DOF gets a unit diagonal.
  for (int r = 0; r < n; ++r) {
    for (auto it = A.rows[r].begin(); it != A.rows[r].end();) {
      int c = it->first;
      if (pinned[r] || pinned[c]) {
        double v = it->second;
        if (!pinned[r] && pinned[c])
          rhs[r] -= v * pinValue[c];
        if (pinned[r] && !pinned[c])
          rhs[c] -= v * pinValue[r];
        it = A.rows[r].erase(it);
      } else {
        ++it;
      }
    }
  }
  for (int idx : pinIdx) A.rows[idx][idx] = 1.0;

  std::vector<double> x(n, 0.0);
  stats.cgIterations = conjugateGradient(A, rhs, x, 1e-10, 20000,
                                         stats.cgResidual);
  island.localUv.resize(nv);
  for (int v = 0; v < nv; ++v)
    island.localUv[v] = Vec2(x[U(v)], x[V(v)]);

  // Correct global orientation: signed UV area must be positive.
  double signedArea = 0.0;
  for (const auto& tri : island.localTris) {
    Vec2 a = island.localUv[tri[0]], b = island.localUv[tri[1]],
          c = island.localUv[tri[2]];
    signedArea += 0.5 * cross(b - a, c - a);
  }
  stats.signedUvArea = signedArea;
  if (signedArea < 0.0) {
    stats.flipped = true;
    for (Vec2& uv : island.localUv) uv.x = -uv.x;
  }

  // Distortion metrics from the per-triangle Jacobian singular values.
  double sumD = 0.0, maxD = 0.0;
  double uvArea = 0.0;
  for (const auto& tri : island.localTris) {
    int i = tri[0], j = tri[1], k = tri[2];
    Vec3 e31 = island.localPos[j] - island.localPos[i];
    Vec3 e32 = island.localPos[k] - island.localPos[i];
    Vec3 normal = normalize(cross(e31, e32));
    Vec3 ax = normalize(e31);
    Vec3 ay = cross(normal, ax);
    // Express the two 3D edges in the triangle's own 2D frame (columns of S)
    // and the two UV edges (columns of T). The 3D -> UV Jacobian is J = T S^-1.
    Vec2 s1{dot(e31, ax), dot(e31, ay)};
    Vec2 s2{dot(e32, ax), dot(e32, ay)};
    Vec2 t1 = island.localUv[j] - island.localUv[i];
    Vec2 t2 = island.localUv[k] - island.localUv[i];
    double detS = s1.x * s2.y - s1.y * s2.x;
    if (std::abs(detS) < 1e-18) continue;
    double invDet = 1.0 / detS;
    // S^-1 maps a 3D-frame vector to barycentric-like coefficients.
    // J = T * S^-1 built column by column.
    double sinv11 = s2.y * invDet, sinv12 = -s2.x * invDet;
    double sinv21 = -s1.y * invDet, sinv22 = s1.x * invDet;
    double j11 = t1.x * sinv11 + t2.x * sinv21;
    double j12 = t1.x * sinv12 + t2.x * sinv22;
    double j21 = t1.y * sinv11 + t2.y * sinv21;
    double j22 = t1.y * sinv12 + t2.y * sinv22;
    double jtj11 = j11 * j11 + j21 * j21;
    double jtj12 = j11 * j12 + j21 * j22;
    double jtj22 = j12 * j12 + j22 * j22;
    double trace = jtj11 + jtj22;
    double det = jtj11 * jtj22 - jtj12 * jtj12;
    double disc = std::sqrt(std::max(0.0, trace * trace * 0.25 - det));
    double sMax = std::sqrt(std::max(0.0, trace * 0.5 + disc));
    double sMin = std::sqrt(std::max(0.0, trace * 0.5 - disc));
    if (sMin > 1e-12) {
      double d = sMax / sMin - 1.0;
      sumD += d;
      maxD = std::max(maxD, d);
    }
    uvArea += 0.5 * std::abs(cross(t1, t2));
  }
  stats.meanDistortion = island.localTris.empty() ? 0.0 :
                         sumD / static_cast<double>(island.localTris.size());
  stats.maxDistortion = maxD;

  // Normalize scale: make UV area match world area (density 1.0 here; the
  // packer converts to texels), then shift the min corner to the origin.
  if (uvArea > 1e-18) {
    double scale = std::sqrt(island.worldArea / uvArea);
    for (Vec2& uv : island.localUv) uv = uv * scale;
  }
  Vec2 mn{1e300, 1e300};
  for (const Vec2& uv : island.localUv) {
    mn.x = std::min(mn.x, uv.x);
    mn.y = std::min(mn.y, uv.y);
  }
  for (Vec2& uv : island.localUv) uv = uv - mn;
  return stats;
}

} // namespace lmuv
