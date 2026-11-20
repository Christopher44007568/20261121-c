"""Numerical checks for the closed-ribbon math. Run: python3 validation/test_ribbon.py"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from ribbon_builder import assemble_ribbon
from ribbon_math import cross, dot, length, normalize


PASSED = 0


def check(name, condition, detail=""):
    global PASSED
    if not condition:
        raise AssertionError(name + ((": " + detail) if detail else ""))
    PASSED += 1
    print("  ok -", name)


def helix_points():
    points = []
    widths = []
    offsets = []
    count = 9
    for i in range(count):
        angle = i * math.tau / count
        radius = 2.4 + 0.5 * math.sin(angle * 2)
        points.append((
            radius * math.cos(angle),
            1.6 * math.sin(angle * 2),
            radius * math.sin(angle)))
        widths.append(0.42 + 0.1 * math.sin(angle * 3))
        offsets.append(0.62)
    return points, widths, offsets


def inflection_points():
    points = [
        (-2.6, 0.0, 0.0), (-1.1, 0.25, 1.5), (0.0, 0.0, 0.0),
        (1.1, -0.25, 1.5), (2.6, 0.0, 0.0), (1.1, 0.25, -1.5),
        (0.0, 0.0, 0.0), (-1.1, -0.25, -1.5),
    ]
    count = len(points)
    return points, [0.46] * count, [0.35] * count


def stationary_points():
    points = [
        (-2.2, 0.0, 0.0), (-0.8, 0.35, 1.3),
        (0.79995, 0.05, 0.6), (0.8, 0.05, 0.6),
        (2.2, 0.0, 0.0), (0.8, -0.3, -1.4),
    ]
    return points, [0.4, 0.4, 0.28, 0.28, 0.4, 0.4], [0.55] * len(points)


def assert_frames_orthonormal(ribbon):
    for frame in ribbon["frames"]:
        check_axes = (
            abs(length(frame["normal"]) - 1.0) < 1e-6,
            abs(length(frame["binormal"]) - 1.0) < 1e-6,
            abs(dot(frame["normal"], frame["tangent"])) < 1e-6,
            abs(dot(frame["binormal"], frame["tangent"])) < 1e-6,
        )
        if not all(check_axes):
            raise AssertionError("frame lost orthonormality")


def assert_no_nan(ribbon):
    for pair in ribbon["vertices"]:
        for vertex in pair:
            if any(not math.isfinite(component) for component in vertex):
                raise AssertionError("non-finite vertex produced")


def assert_seam_continuity(ribbon, tolerance=2e-4):
    first = ribbon["frames"][0]
    last = ribbon["closing_frame"]
    normal_gap = length((
        first["normal"][0] - last["normal"][0],
        first["normal"][1] - last["normal"][1],
        first["normal"][2] - last["normal"][2]))
    check("closing normal seam continuous", normal_gap < tolerance,
          "gap={:.6f}".format(normal_gap))

    edge_first = ribbon["vertices"][0]
    edge_last = ribbon["vertices"][-1]
    gap_minus = length(tuple(edge_first[0][k] - edge_last[0][k] for k in range(3)))
    gap_plus = length(tuple(edge_first[1][k] - edge_last[1][k] for k in range(3)))
    check("closing edge vertices meet", max(gap_minus, gap_plus) < tolerance,
          "minus={:.6f} plus={:.6f}".format(gap_minus, gap_plus))


def assert_uniform_spacing(ribbon):
    interior = len(ribbon["frames"])
    arcs = [ring["arc"] for ring in ribbon["rings"][:interior]]
    deltas = [arcs[i + 1] - arcs[i] for i in range(len(arcs) - 1)]
    spread = (max(deltas) - min(deltas)) / sum(deltas) * len(deltas)
    check("rings evenly spaced by arc length", spread < 0.02,
          "relative spread={:.5f}".format(spread))


def assert_smooth_normals_no_flip(ribbon):
    # Parallel transport must produce gradual changes; consecutive corrected
    # normals never approach a 180 degree flip. On high-curvature regions the
    # normal change tracks the tangent change, so we compare the two as well.
    normals = [frame["normal"] for frame in ribbon["frames"]]
    tangents = [frame["tangent"] for frame in ribbon["frames"]]
    worst = 0.0
    worst_ratio = 0.0
    for i in range(1, len(normals)):
        cosine = max(-1.0, min(1.0, dot(normals[i - 1], normals[i])))
        worst = max(worst, math.acos(cosine))
        tangent_angle = math.acos(max(-1.0, min(1.0,
            dot(tangents[i - 1], tangents[i]))))
        if tangent_angle > 1e-6:
            worst_ratio = max(worst_ratio, math.acos(cosine) / tangent_angle)
    check("transported normals never flip between rings", worst < math.radians(60),
          "worst jump={:.2f} deg".format(math.degrees(worst)))
    check("normal change tracks tangent change under transport",
          worst_ratio < 1.6, "ratio={:.3f}".format(worst_ratio))


def assert_asymmetric_uv(ribbon):
    uvs = ribbon["uvs"]
    check("across-width UV spans 0..1",
          abs(uvs[0][0][1]) < 1e-9 and abs(uvs[0][1][1] - 1.0) < 1e-9)
    u_start = uvs[0][0][0]
    u_end = uvs[-1][0][0]
    check("longitudinal UV covers the configured repeat range",
          abs(u_start) < 1e-9 and u_end > 1.0,
          "end u={:.3f}".format(u_end))


def assert_residual_removed_but_measured():
    points, widths, offsets = inflection_points()
    corrected = assemble_ribbon(points, widths, offsets, correct_twist=True)
    raw = assemble_ribbon(points, widths, offsets, correct_twist=False)

    check("high-torsion loop yields a measurable residual twist",
          abs(corrected["residual"]) > math.radians(30),
          "residual={:.2f} deg".format(math.degrees(corrected["residual"])))

    # Without correction the transported closing raw normal does not match ring 0.
    raw_gap = length(tuple(
        raw["closing_frame"]["raw_normal"][k] - raw["frames"][0]["raw_normal"][k]
        for k in range(3)))
    check("uncorrected loop leaves an open normal seam",
          raw_gap > 0.3, "raw gap={:.4f}".format(raw_gap))

    assert_seam_continuity(corrected)

    # A near-symmetric helix legitimately has almost no residual twist; the
    # machinery must still report it and keep the seam closed.
    h_points, h_widths, h_offsets = helix_points()
    helix = assemble_ribbon(h_points, h_widths, h_offsets,
                            ring_count=260, texture_repeat=8.0)
    check("symmetric helix reports near-zero residual twist",
          abs(helix["residual"]) < math.radians(5),
          "residual={:.3f} deg".format(math.degrees(helix["residual"])))
    assert_seam_continuity(helix)


def main():
    print("Helix loop")
    points, widths, offsets = helix_points()
    helix = assemble_ribbon(points, widths, offsets,
                            ring_count=260, texture_repeat=8.0)
    assert_no_nan(helix)
    assert_frames_orthonormal(helix)
    assert_uniform_spacing(helix)
    assert_smooth_normals_no_flip(helix)
    assert_asymmetric_uv(helix)

    print("Inflection loop")
    points, widths, offsets = inflection_points()
    inflection = assemble_ribbon(points, widths, offsets, ring_count=260)
    assert_no_nan(inflection)
    assert_frames_orthonormal(inflection)
    assert_smooth_normals_no_flip(inflection)
    assert_seam_continuity(inflection)

    print("Nearly stationary adjacent control points")
    points, widths, offsets = stationary_points()
    stationary = assemble_ribbon(
        points, widths, offsets, ring_count=240, samples_per_segment=32)
    assert_no_nan(stationary)
    assert_frames_orthonormal(stationary)
    assert_smooth_normals_no_flip(stationary)
    assert_seam_continuity(stationary)

    print("Residual twist handling")
    assert_residual_removed_but_measured()

    print("\nAll {} checks passed.".format(PASSED))


if __name__ == "__main__":
    main()
