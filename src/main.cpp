#include "lmuv/json.h"
#include "lmuv/mesh.h"
#include "lmuv/io.h"
#include <iostream>
#include <string>

using namespace lmuv;

namespace {

struct Args {
  std::string command;
  std::string input;
  std::string output;
  std::string objOutput;
  std::string onlyPart;
};

void usage() {
  std::cerr <<
      "usage:\n"
      "  lmuv rebuild <scene.json> --out <layout.json> [--obj <out.obj>]\n"
      "                            [--only <partName>]\n"
      "  lmuv verify  <scene.json> [--only <partName>]\n"
      "\n"
      "exit code is 0 when the produced layout satisfies every hard\n"
      "constraint (bounds, border/island padding), 1 otherwise.\n";
}

Args parseArgs(int argc, char** argv) {
  Args a;
  if (argc < 2) usage();
  a.command = argv[1];
  for (int i = 2; i < argc; ++i) {
    std::string flag = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) throw std::runtime_error("missing value for " + flag);
      return argv[++i];
    };
    if (flag == "--out") a.output = next();
    else if (flag == "--obj") a.objOutput = next();
    else if (flag == "--only") a.onlyPart = next();
    else if (a.input.empty()) a.input = flag;
    else throw std::runtime_error("unexpected argument: " + flag);
  }
  if (a.command != "rebuild" && a.command != "verify")
    throw std::runtime_error("unknown command: " + a.command);
  if (a.input.empty()) throw std::runtime_error("missing scene file");
  return a;
}

} // namespace

int main(int argc, char** argv) {
  Args args;
  try {
    args = parseArgs(argc, argv);
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    usage();
    return 2;
  }

  try {
    Json root = Json::parse(readFile(args.input));
    Scene scene = loadScene(root);
    BuildOptions options;
    options.onlyPart = args.onlyPart;
    BuildOutput output = rebuild(scene, options);

    if (!output.ok) {
      std::cerr << "rebuild failed: " << output.error << "\n";
      for (const std::string& e : output.report.errors)
        std::cerr << "  - " << e << "\n";
      if (!args.output.empty())
        writeFile(args.output, buildOutputJson(scene, output).dump());
      return 1;
    }

    const VerifyReport& r = output.report;
    std::cout << "parts: " << output.built.size()
              << " | mode: " << (args.onlyPart.empty() ? "full" : "local")
              << "\n"
              << "min island gap: " << r.minIslandGap
              << " texels (required " << r.requiredPadding << ")\n"
              << "min border gap: " << r.minBorderGap << " texels\n"
              << "mean/max distortion: " << r.meanDistortion << " / "
              << r.maxDistortion << "\n"
              << "texel density range: " << r.minTexelDensity << " .. "
              << r.maxTexelDensity << "\n";

    if (!args.output.empty())
      writeFile(args.output, buildOutputJson(scene, output).dump());
    if (!args.objOutput.empty())
      writeFile(args.objOutput, buildObj(scene, output));
    return r.valid ? 0 : 1;
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 2;
  }
}
