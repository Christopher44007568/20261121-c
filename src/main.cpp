#include <algorithm>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
#include "field.hpp"
#include "mesher.hpp"
#include "mesh.hpp"

namespace {

Grid makeGrid(const FieldInfo& f, int n) {
  Grid g;
  g.nx = g.ny = g.nz = n;
  g.origin = f.domainMin;
  g.spacing = {(f.domainMax.x - f.domainMin.x) / (n - 1),
               (f.domainMax.y - f.domainMin.y) / (n - 1),
               (f.domainMax.z - f.domainMin.z) / (n - 1)};
  g.val.resize(static_cast<size_t>(n) * n * n);
  for (int k = 0; k < n; ++k)
    for (int j = 0; j < n; ++j)
      for (int i = 0; i < n; ++i)
        g.val[(static_cast<size_t>(k) * n + j) * n + i] =
            f.fn(g.pos(i, j, k));
  return g;
}

void printStats(double iso, const MeshStats& s) {
  std::printf(
      "iso=%+8.4f  V=%6zu  F=%7zu  components=%2zu  boundary=%4zu  "
      "nonmanifold=%3zu  euler=%4ld\n",
      iso, s.numVertices, s.numTris, s.components, s.boundaryEdges,
      s.nonManifoldEdges, s.euler);
}

void usage(const char* argv0) {
  std::cout <<
      "Usage:\n"
      "  " << argv0 << " --field F --iso V [--grid N] [--out mesh.obj] [--chunks x,y,z]\n"
      "  " << argv0 << " --field F --sweep lo:hi:steps [--grid N]\n"
      "  " << argv0 << " --field F --verify [--grid N] [--iso V]\n"
      "  " << argv0 << " --field F --repl [--grid N]\n"
      "Fields: blobs (components 2->1), torus (genus 1->0), gyroid\n";
}

// Canonical mesh signature: sorted vertex coordinates and sorted
// per-triangle coordinate triples. Independent of vertex numbering,
// so two runs must match exactly if stitching is consistent.
std::string meshSignature(const IndexedMesh& m) {
  std::vector<std::string> lines;
  char buf[256];
  for (const Vec3& v : m.vertices) {
    std::snprintf(buf, sizeof buf, "v %.17e %.17e %.17e", v.x, v.y, v.z);
    lines.emplace_back(buf);
  }
  for (const Tri& t : m.tris) {
    const Vec3& a = m.vertices[t.a];
    const Vec3& b = m.vertices[t.b];
    const Vec3& c = m.vertices[t.c];
    std::snprintf(buf, sizeof buf, "t %.17e %.17e %.17e %.17e %.17e %.17e %.17e %.17e %.17e",
                  a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    lines.emplace_back(buf);
  }
  std::sort(lines.begin(), lines.end());
  std::string sig;
  for (auto& l : lines) {
    sig += l;
    sig += '\n';
  }
  return sig;
}

}  // namespace

int main(int argc, char** argv) {
  std::string fieldName, outPath, sweepSpec, chunkSpec;
  double iso = 0.0;
  bool haveIso = false, doVerify = false, doRepl = false;
  int gridN = 64;

  for (int a = 1; a < argc; ++a) {
    std::string arg = argv[a];
    auto next = [&]() -> std::string {
      if (a + 1 >= argc) throw std::runtime_error("missing value for " + arg);
      return argv[++a];
    };
    if (arg == "--field") fieldName = next();
    else if (arg == "--iso") { iso = std::stod(next()); haveIso = true; }
    else if (arg == "--grid") gridN = std::stoi(next());
    else if (arg == "--out") outPath = next();
    else if (arg == "--sweep") sweepSpec = next();
    else if (arg == "--chunks") chunkSpec = next();
    else if (arg == "--verify") doVerify = true;
    else if (arg == "--repl") doRepl = true;
    else if (arg == "--help" || arg == "-h") { usage(argv[0]); return 0; }
    else { std::cerr << "unknown arg: " << arg << "\n"; usage(argv[0]); return 1; }
  }
  if (fieldName.empty()) { usage(argv[0]); return 1; }

  try {
    FieldInfo field = getField(fieldName);
    Grid g = makeGrid(field, gridN);

    if (doVerify) {
      if (!haveIso) iso = (field.sweepLo + field.sweepHi) * 0.5;
      // Same field, same iso, two different chunk decompositions.
      IndexedMesh m1 = meshGrid(g, iso, 1, 1, 1);
      IndexedMesh m2 = meshGrid(g, iso, 2, 3, 2);
      MeshStats s1 = computeStats(m1), s2 = computeStats(m2);
      std::printf("chunking 1x1x1: ");
      printStats(iso, s1);
      std::printf("chunking 2x3x2: ");
      printStats(iso, s2);
      bool sameMesh = meshSignature(m1) == meshSignature(m2);
      bool ok = sameMesh && s1.nonManifoldEdges == 0 &&
                s2.nonManifoldEdges == 0 && s1.components == s2.components;
      std::printf("identical mesh under both chunkings: %s\n",
                  sameMesh ? "yes" : "NO");
      std::printf("VERIFY %s\n", ok ? "PASS" : "FAIL");
      return ok ? 0 : 2;
    }

    if (!sweepSpec.empty()) {
      double lo, hi;
      int steps;
      if (std::sscanf(sweepSpec.c_str(), "%lf:%lf:%d", &lo, &hi, &steps) != 3)
        throw std::runtime_error("bad --sweep, expected lo:hi:steps");
      size_t prevComp = SIZE_MAX;
      for (int s = 0; s < steps; ++s) {
        double t = steps > 1 ? static_cast<double>(s) / (steps - 1) : 0.0;
        double v = lo + (hi - lo) * t;
        IndexedMesh m = meshGrid(g, v, 1, 1, 1);
        MeshStats st = computeStats(m);
        printStats(v, st);
        if (prevComp != SIZE_MAX && st.components != prevComp)
          std::printf("  ** topology change: components %zu -> %zu **\n",
                      prevComp, st.components);
        prevComp = st.components;
      }
      return 0;
    }

    if (doRepl) {
      std::cout << "interactive sweep; enter iso values, q to quit\n";
      std::string line;
      while (std::cout << "iso> " && std::getline(std::cin, line)) {
        if (line == "q" || line == "quit") break;
        if (line.empty()) continue;
        double v = std::stod(line);
        IndexedMesh m = meshGrid(g, v, 1, 1, 1);
        printStats(v, computeStats(m));
      }
      return 0;
    }

    if (!haveIso) iso = (field.sweepLo + field.sweepHi) * 0.5;
    int cx = 1, cy = 1, cz = 1;
    if (!chunkSpec.empty())
      if (std::sscanf(chunkSpec.c_str(), "%d,%d,%d", &cx, &cy, &cz) != 3)
        throw std::runtime_error("bad --chunks, expected x,y,z");
    IndexedMesh m = meshGrid(g, iso, cx, cy, cz);
    printStats(iso, computeStats(m));
    if (!outPath.empty()) {
      exportObj(m, outPath);
      std::cout << "wrote " << outPath << "\n";
    }
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
