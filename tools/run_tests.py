#!/usr/bin/env python3
"""End-to-end checks for the lmuv offline lightmap UV rebuilder."""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILD = os.environ.get("LMUV_BUILD", os.path.join(ROOT, "build"))
TESTS = os.path.join(ROOT, "tests")
OUT = os.path.join(BUILD, "test-out")


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def load(path):
    with open(path) as f:
        return json.load(f)


class Checks:
    def __init__(self):
        self.failed = []

    def expect(self, cond, message):
        if not cond:
            self.failed.append(message)


def main():
    os.makedirs(OUT, exist_ok=True)
    gen = run([sys.executable, "tools/gen_tests.py"])
    if gen.returncode != 0:
        print(gen.stderr)
        return 2

    checks = Checks()

    def rebuild(scene_name, extra=None, expect_success=True):
        scene = scene_name if (os.path.isabs(scene_name) or
                               os.path.exists(scene_name)) else \
            os.path.join(TESTS, scene_name)
        stem = os.path.splitext(os.path.basename(scene_name))[0]
        out_json = os.path.join(OUT, scene_name.replace(".json", "_out.json"))
        out_json = os.path.join(OUT, stem + "_out.json")
        out_obj = os.path.join(OUT, stem + ".obj")
        cmd = [os.path.join(BUILD, "lmuv"), "rebuild", scene,
               "--out", out_json, "--obj", out_obj]
        if extra:
            cmd += extra
        proc = run(cmd)
        data = load(out_json)
        if expect_success:
            checks.expect(proc.returncode == 0,
                          f"{scene_name}: expected success, got {proc.returncode}: "
                          + proc.stderr.strip())
            checks.expect(data.get("ok") is True,
                          f"{scene_name}: ok flag is false: {data.get('error')}")
        else:
            checks.expect(proc.returncode != 0,
                          f"{scene_name}: expected failure, got success")
            checks.expect(data.get("ok") is False,
                          f"{scene_name}: expected ok=false")
        return data, proc

    # --- 1. adjacent small islands ------------------------------------------------
    data, _ = rebuild("adjacent_islands.json")
    report = data["report"]
    cfg = load(os.path.join(TESTS, "adjacent_islands.json"))["config"]
    checks.expect(len(data["parts"]) == 3, "adjacent: 3 parts expected")
    checks.expect(report["minIslandGapTexels"] >= cfg["padding"] - 1e-6,
                  f"adjacent: island gap {report['minIslandGapTexels']} < "
                  f"{cfg['padding']}")
    checks.expect(report["minBorderGapTexels"] >= cfg["padding"] - 1e-6,
                  "adjacent: border padding violated")
    checks.expect(report["insideBounds"] is True,
                  "adjacent: UV left the [0,1] atlas")
    checks.expect(report["maxDistortion"] < 0.05,
                  f"adjacent: flat grids must be near isometric, got "
                  f"{report['maxDistortion']}")

    # --- 2. non-uniform scale -----------------------------------------------------
    data, _ = rebuild("nonuniform_scale.json")
    report = data["report"]
    cube = next(p for p in data["parts"] if p["name"] == "stretched_cube")
    checks.expect(len(cube["islands"]) == 6,
                  f"cube must split into 6 hard-edge islands, got "
                  f"{len(cube['islands'])}")
    d_lo, d_hi = report["minTexelDensity"], report["maxTexelDensity"]
    checks.expect(d_hi > 0 and abs(d_lo - d_hi) / d_hi < 0.02,
                  f"non-uniform scale: texel density inconsistent "
                  f"{d_lo}..{d_hi}")
    checks.expect(report["maxDistortion"] < 0.25,
                  f"non-uniform scale: distortion too high "
                  f"{report['maxDistortion']}")

    # --- 3. concave corner --------------------------------------------------------
    data, _ = rebuild("concave.json")
    report = data["report"]
    part = data["parts"][0]
    checks.expect(len(part["islands"]) == 1,
                  "concave L must stay one island")
    checks.expect(report["minIslandGapTexels"] == -1.0,
                  "concave: single island should report gap not applicable")
    checks.expect(report["minBorderGapTexels"] >= 4 - 1e-6,
                  "concave: border padding violated")
    checks.expect(report["maxDistortion"] < 0.05,
                  f"concave: planar L should unwrap isometrically, got "
                  f"{report['maxDistortion']}")

    # --- 4. explicit seam ---------------------------------------------------------
    data, _ = rebuild("explicit_seam.json")
    part = data["parts"][0]
    checks.expect(len(part["islands"]) == 2,
                  f"explicit seam must cut strip into 2 islands, got "
                  f"{len(part['islands'])}")

    # --- 5. full rebuild first, then local edit of one part ----------------------
    full, _ = rebuild("local_edit.json")
    full_by_name = {p["name"]: p for p in full["parts"]}
    scene_path = os.path.join(TESTS, "local_edit.json")
    # Inject the full-rebuild UV back into the scene so local mode has a valid
    # baseline, then perturb geometry of the edited part (denser grid UV area).
    scene = load(scene_path)
    # Reconstruct per-vertex UV from the split corner UV (a welded vertex that
    # appears in several corners shares the same value within one part here).
    for p in scene["parts"]:
        corner_uv = full_by_name[p["name"]]["cornerUv"]
        vert_count = len(p["positions"])
        per_vertex = [[0.0, 0.0] for _ in range(vert_count)]
        for tri, cuv in zip(p["triangles"], corner_uv):
            for vi, uv in zip(tri, cuv):
                per_vertex[vi] = uv
        p["uv"] = per_vertex
    seeded = os.path.join(OUT, "local_edit_seeded.json")
    with open(seeded, "w") as f:
        json.dump(scene, f)

    local, proc = rebuild(seeded,
                          extra=["--only", "edit_me"])
    local_by_name = {p["name"]: p for p in local["parts"]}
    checks.expect(local_by_name["edit_me"]["rebuilt"] is True,
                  "local: edit_me must be marked rebuilt")
    checks.expect(local_by_name["neighbour"]["rebuilt"] is False,
                  "local: neighbour must be marked untouched")
    before = full_by_name["neighbour"]["cornerUv"]
    after = local_by_name["neighbour"]["cornerUv"]
    checks.expect(before == after,
                  "local: neighbour UV changed despite being untouched")
    checks.expect(local["report"]["minIslandGapTexels"] >= 6 - 1e-6,
                  "local: padding violated after partial rebuild")

    # --- 6. oversize failure must be clean ---------------------------------------
    rebuild("oversize.json", expect_success=False)

    if checks.failed:
        print("FAIL")
        for m in checks.failed:
            print(" -", m)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
