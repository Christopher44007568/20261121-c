#pragma once
#include "lmuv/mesh.h"
#include "lmuv/verify.h"

namespace lmuv {

struct BuildOptions {
  std::string onlyPart;      // empty = full rebuild
};

struct BuildOutput {
  bool ok = false;
  std::string error;
  std::vector<BuiltPart> built;
  VerifyReport report;
};

BuildOutput rebuild(Scene& scene, const BuildOptions& options);
Json buildOutputJson(const Scene& scene, const BuildOutput& output);
std::string buildObj(const Scene& scene, const BuildOutput& output);

} // namespace lmuv
