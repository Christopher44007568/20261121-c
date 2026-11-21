// End-to-end CLI demo: run every boolean operation on a fixture and print the
// acceptance checks (area identity + raster coverage) alongside diagnostics.

import { booleanPolygons } from "../src/index.js";
import {
  checkAreaIdentity,
  checkDifferenceIdentity,
  rasterCrossCheck,
} from "../src/verify.js";
import { Diagnostics } from "../src/diagnostics.js";
import { fixtures } from "../test/fixtures.js";

const fixtureName = process.argv[2] ?? "crossingSquares";
const fixture = fixtures[fixtureName];
if (!fixture) {
  console.error(`unknown fixture: ${fixtureName}`);
  console.error(`available: ${Object.keys(fixtures).join(", ")}`);
  process.exit(1);
}

const operations = ["union", "intersection", "difference", "xor"];
const results = Object.fromEntries(
  operations.map((op) => [op, booleanPolygons(fixture, { operation: op })]),
);

console.log(`fixture: ${fixtureName}\n`);
for (const op of operations) {
  const result = results[op];
  const raster = rasterCrossCheck(result, result.quantizedInputs, op);
  console.log(`[${op}]`);
  console.log(`  polygons=${result.metrics.polygonCount} boundaryEdges=${result.metrics.boundaryEdges} triangulable=${result.metrics.triangulable}`);
  console.log(`  raster: ${raster.samples.compared} cells, mismatches=${raster.mismatchCount}`);
  for (const poly of result.polygons) {
    console.log(`    area=${poly.area} outerVerts=${poly.outer.length} holes=${poly.holes.length} triangles=${poly.triangles.length}`);
  }
  const diagSummary = summarize(result.diagnostics);
  if (diagSummary) console.log(`  diagnostics: ${diagSummary}`);
  console.log();
}

const identityDiag = new Diagnostics();
const areaIdentity = checkAreaIdentity(
  results.union,
  results.intersection,
  results.union.quantizedInputs,
  results.intersection.quantizedInputs,
  identityDiag,
);
const diffIdentity = checkDifferenceIdentity(
  results.difference,
  results.union.quantizedInputs,
  results.intersection,
  identityDiag,
);
console.log("acceptance");
console.log(`  inclusion-exclusion A+B = union + intersection: ${areaIdentity.ok ? "PASS" : "FAIL"}`);
console.log(`  difference identity (A-B) + (A∩B) = A:          ${diffIdentity.ok ? "PASS" : "FAIL"}`);

function summarize(entries) {
  if (!entries.length) return "none";
  const counts = {};
  for (const entry of entries) counts[entry.code] = (counts[entry.code] ?? 0) + 1;
  return Object.entries(counts).map(([code, n]) => `${code}×${n}`).join(", ");
}
