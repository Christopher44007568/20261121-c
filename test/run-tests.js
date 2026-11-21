import { booleanPolygons } from "../src/index.js";
import { Q } from "../src/rational.js";
import {
  checkAreaIdentity,
  checkDifferenceIdentity,
  rasterCrossCheck,
} from "../src/verify.js";
import { Diagnostics } from "../src/diagnostics.js";
import { fixtures } from "./fixtures.js";

const ZERO_Q = new Q(0n);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}\n        ${err.stack || err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

const ops = ["union", "intersection", "difference", "xor"];

for (const [name, fixture] of Object.entries(fixtures)) {
  for (const op of ops) {
    test(`${name} / ${op} passes raster cross-check`, () => {
      const result = booleanPolygons(fixture, { operation: op, scale: 1 });
      const check = rasterCrossCheck(result, result.quantizedInputs, op);
      if (!check.ok) {
        console.log("DEBUG", name, op, JSON.stringify(check.mismatches.slice(0, 3)), "diags", result.diagnostics.map((d) => d.code).join(","));
      }
      assert(check.ok, `raster mismatch x${check.mismatchCount}: ${JSON.stringify(check.mismatches[0])}`);
      if (!result.metrics.triangulable || result.diagnostics.some((d) => d.severity === "error")) {
        console.log("DEBUG2", name, op, "triangulable", result.metrics.triangulable, "errs", result.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code}:${d.message}`));
      }
      assert(result.metrics.triangulable, "result not triangulable");
      assert(!result.diagnostics.some((d) => d.severity === "error"), "unexpected errors");
    });
  }
}

test("tangent squares: union keeps both areas, intersection is empty", () => {
  const union = booleanPolygons(fixtures.tangentSquares, { operation: "union" });
  const inter = booleanPolygons(fixtures.tangentSquares, { operation: "intersection" });
  assertEq(union.polygons.length, 2, "two separate outer rings");
  assertEq(inter.polygons.length, 0, "point contact has no area");
  assert(Array.isArray(union.diagnostics), "diagnostics are reported");
});

test("shared edge: union is one rectangle and shared edge is cancelled", () => {
  const union = booleanPolygons(fixtures.sharedEdge, { operation: "union" });
  assertEq(union.polygons.length, 1, "merged into one polygon");
  assertEq(union.polygons[0].outer.length, 4, "outer ring is a rectangle");
  assertEq(union.polygons[0].area, 32, "area 8x4");
  const shared = union.degenerateEdges.find((e) => e.tags.includes("shared"));
  assert(shared, "shared edge reported as degenerate");
  assert(shared.tags.includes("cancelled"), "opposite winding cancels");
});

test("nested hole: difference preserves annular region with one hole", () => {
  const diff = booleanPolygons(fixtures.nestedHole, { operation: "difference" });
  assertEq(diff.polygons.length, 1, "single outer polygon");
  assertEq(diff.polygons[0].holes.length, 1, "one hole remains");
  assertEq(diff.polygons[0].area, 100 - 16, "annulus area 84; B sits inside the hole");
});

test("near threshold: warnings emitted and snapping is deterministic", () => {
  const r1 = booleanPolygons(fixtures.nearThreshold, { operation: "union" });
  const r2 = booleanPolygons(fixtures.nearThreshold, { operation: "union" });
  assert(r1.diagnostics.some((d) => d.code === "W_NEAR_THRESHOLD"), "near-threshold warning");
  const stable = (r) => r.polygons.map((p) => `${p.area2}:${p.outer.map((q) => `${q.x}/${q.y}`).join(",")}`).join("|");
  assertEq(stable(r1), stable(r2), "deterministic output");
});

test("scaled near-threshold geometry lands on different integer grid", () => {
  const scaled = fixtures.nearThreshold.map((set) => ({
    id: set.id,
    polygons: set.polygons.map((p) => ({
      rings: p.rings.map((ring) => ring.map(([x, y]) => [x * 10, y * 10])),
    })),
  }));
  const result = booleanPolygons(scaled, { operation: "union", scale: 10 });
  const check = rasterCrossCheck(result, result.quantizedInputs, "union");
  assert(check.ok, "scaled raster check");
});

test("area identity A+B = union + intersection for every fixture", () => {
  const diag = new Diagnostics();
  for (const fixture of Object.values(fixtures)) {
    const union = booleanPolygons(fixture, { operation: "union" });
    const inter = booleanPolygons(fixture, { operation: "intersection" });
    const diff = booleanPolygons(fixture, { operation: "difference" });
    const id1 = checkAreaIdentity(union, inter, union.quantizedInputs, inter.quantizedInputs, diag);
    const id2 = checkDifferenceIdentity(diff, union.quantizedInputs, inter, diag);
    assert(id1.ok, "inclusion-exclusion failed");
    assert(id2.ok, "difference identity failed");
  }
  assert(!diag.hasErrors(), diag.text());
});

test("triangulated area equals polygon area for diagonal/hole case", () => {
  const result = booleanPolygons(fixtures.diagonalHole, { operation: "union" });
  for (const poly of result.polygons) {
    assert(poly.triangles.length > 0, "produces triangles");
    const triArea2 = poly.triangles.reduce((sum, t) => sum.add(triangleArea2(t)), ZERO_Q);
    assertEq(triArea2.toString(), poly.area2, "triangle area matches");
  }
});

function triangleArea2(t) {
  const [a, b, c] = t;
  const v = a.x.mul(b.y.sub(c.y))
    .add(b.x.mul(c.y.sub(a.y)))
    .add(c.x.mul(a.y.sub(b.y)));
  return v.n < 0n ? v.neg() : v;
}

test("fuzz: random axis-aligned rectangles satisfy all raster checks", () => {
  let seed = 20261121;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 60; iter++) {
    const rect = () => {
      const x = Math.floor(rand() * 8);
      const y = Math.floor(rand() * 8);
      const w = 1 + Math.floor(rand() * 6);
      const h = 1 + Math.floor(rand() * 6);
      return { rings: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] };
    };
    const sets = [
      { id: "A", polygons: [rect(), rect()] },
      { id: "B", polygons: [rect()] },
    ];
    for (const op of ops) {
      const result = booleanPolygons(sets, { operation: op });
      const check = rasterCrossCheck(result, result.quantizedInputs, op);
      assert(check.ok, `fuzz ${iter}/${op}: ${check.mismatchCount} mismatches`);
      assert(result.metrics.triangulable, `fuzz ${iter}/${op}: not triangulable`);
    }
  }
});

test("error diagnostic for non-finite input instead of crash", () => {
  const bad = [
    { id: "A", polygons: [{ rings: [[[0, 0], [4, 0], [4, NaN], [0, 4]]] }] },
    { id: "B", polygons: [{ rings: [[[2, 2], [6, 2], [6, 6], [2, 6]]] }] },
  ];
  let threw = false;
  try {
    booleanPolygons(bad, { operation: "union" });
  } catch {
    threw = true;
  }
  assert(threw, "non-finite input surfaces as exception for caller handling");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
