import { mkdir, writeFile } from "node:fs/promises";
import { buildScene, CAMERA_STATIONS, VIEW_CONFIG } from "../src/scene.js";
import { createAnalyzer } from "../src/visibility.js";
import { depthQuantization, offsetFailureDistance } from "../src/math.js";

const solid = buildScene();
const analyzer = createAnalyzer(solid, VIEW_CONFIG);
const settings = {
  offset: 0.05,
  tolerance: 1e-9,
  aspect: 16 / 9
};
const stations = CAMERA_STATIONS.map((station) => {
  const result = analyzer.analyze(station, settings);
  return {
    id: station.id,
    name: station.name,
    result: {
      ...result,
      offsetFar: Number.isFinite(result.offsetFar) ? result.offsetFar : "none",
      depthFar: Number.isFinite(result.depthFar) ? result.depthFar : "none"
    }
  };
});
const report = {
  generatedAt: new Date().toISOString(),
  config: {
    ...VIEW_CONFIG,
    offset: settings.offset,
    tolerance: settings.tolerance,
    depthQuantization: depthQuantization(VIEW_CONFIG.depthBits),
    analyticOffsetFailureDistance: offsetFailureDistance(
      settings.offset,
      VIEW_CONFIG.near,
      VIEW_CONFIG.far,
      VIEW_CONFIG.depthBits
    )
  },
  geometry: {
    parts: solid.parts.length,
    triangles: solid.triangles.length,
    edges: solid.edges.length,
    thinBackEdges: solid.edges.filter((edge) => edge.thinBack).length,
    coplanarEdges: solid.edges.filter((edge) => edge.kind === "coplanar").length
  },
  stations
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log("artifacts/report.json");
