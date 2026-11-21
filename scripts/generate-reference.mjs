import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeConvergence, computeDiagnostics, computeDistanceSweep, computeReference } from "../src/analysis.js";
import { BVH } from "../src/bvh.js";
import { createScene } from "../src/scenes.js";
import { writePng } from "./png.mjs";
import { overlayDiagnostics, renderReference } from "./software-render.mjs";
import { convergenceSvg, distanceSweepSvg } from "./svg.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "artifacts");
const referenceDir = join(artifacts, "reference");
const dataDir = join(artifacts, "data");
mkdirSync(referenceDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const cases = [];
const diagnosticsCases = {};
const referenceAO = { referenceSamples: 512, cases: {} };
const diagnosticSeeds = {
  "sphere-plane": 10,
  "edge-contact": 19,
  "stacked-gap": 16
};

for (const id of ["sphere-plane", "edge-contact", "stacked-gap"]) {
  const started = performance.now();
  const scene = createScene(id);
  const bvh = new BVH(scene.mesh);
  process.stdout.write(`[${id}] reference 512 SPP ... `);
  const reference = computeReference(scene, { bvh, samples: 512 });
  process.stdout.write(`${Math.round(performance.now() - started)} ms\n`);

  process.stdout.write(`[${id}] convergence ... `);
  const convergence = computeConvergence(scene, { bvh, reference });
  const distanceSweep = computeDistanceSweep(scene, { bvh, samples: 64 });
  const diagnostics = computeDiagnostics(scene, reference, {
    bvh,
    seed: diagnosticSeeds[id]
  });
  process.stdout.write(`${diagnostics.total} diagnostics\n`);

  process.stdout.write(`[${id}] reference images ... `);
  const lit = renderReference(scene, reference.ao, { mode: "lit" });
  writePng(join(referenceDir, `${id}-reference.png`), lit.width, lit.height, lit.rgba);
  const aoOnly = renderReference(scene, reference.ao, { mode: "ao" });
  writePng(join(referenceDir, `${id}-ao.png`), aoOnly.width, aoOnly.height, aoOnly.rgba);
  const marked = renderReference(scene, reference.ao, { mode: "lit" });
  overlayDiagnostics(marked, diagnostics.points);
  writePng(join(referenceDir, `${id}-diagnostics.png`), marked.width, marked.height, marked.rgba);
  console.log("done");

  cases.push({
    id,
    title: scene.title,
    subtitle: scene.subtitle,
    maxDistance: scene.maxDistance,
    referenceSamples: reference.samples,
    vertexCount: scene.vertexCount,
    triangleCount: scene.triangleCount,
    referenceMs: reference.ms,
    series: convergence.series,
    distanceSweep
  });
  diagnosticsCases[id] = {
    title: scene.title,
    referenceSamples: reference.samples,
    maxDistance: scene.maxDistance,
    stress: diagnostics
  };
  referenceAO.cases[id] = reference;
}

const generatedAt = new Date().toISOString();
const convergence = {
  generatedAt,
  methodology: {
    referenceSamples: 512,
    seeds: [1, 2, 3],
    sampleCounts: [4, 8, 16, 32, 64, 128, 256, 512],
    sampling: "cosine-weighted, normal-oriented Hammersley hemisphere",
    suppression: "normal bias + ray tMin + source-part skip + source-face skip"
  },
  cases
};

writeFileSync(join(dataDir, "convergence.json"), `${JSON.stringify(convergence, null, 2)}\n`);
writeFileSync(join(dataDir, "diagnostics.json"), `${JSON.stringify({
  generatedAt,
  referenceSamples: 512,
  cases: diagnosticsCases
}, null, 2)}\n`);
writeFileSync(join(dataDir, "reference-ao.json"), `${JSON.stringify(referenceAO)}\n`);
writeFileSync(join(artifacts, "convergence.svg"), `${convergenceSvg(cases)}\n`);
writeFileSync(join(artifacts, "distance-sweep.svg"), `${distanceSweepSvg(cases)}\n`);

console.log(`Generated artifacts in ${artifacts}`);
