"""Command line interface for the constrained QEM simplifier."""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qem_simplify.generate import build_test_mesh
from qem_simplify.io import load_obj, write_obj
from qem_simplify.lod import build_lod_levels
from qem_simplify.simplifier import Simplifier, SimplifyOptions


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Constrained QEM mesh simplifier")
    sub = p.add_subparsers(dest="cmd", required=True)

    gen = sub.add_parser("generate", help="write the procedural test model")
    gen.add_argument("out")

    one = sub.add_parser("simplify", help="single simplification pass")
    one.add_argument("input")
    one.add_argument("output")
    one.add_argument("--ratio", type=float, default=0.5)
    _add_policy_args(one)

    lod = sub.add_parser("lod", help="write a sequence of LOD levels")
    lod.add_argument("input")
    lod.add_argument("out_dir")
    lod.add_argument("--ratios", type=float, nargs="+",
                     default=[0.75, 0.5, 0.35, 0.2, 0.1])
    _add_policy_args(lod)
    exp = sub.add_parser("experiment", help="LOD + silhouette study")
    exp.add_argument("input")
    exp.add_argument("out_dir")
    exp.add_argument("--ratios", type=float, nargs="+",
                     default=[0.75, 0.5, 0.35, 0.2, 0.1])
    exp.add_argument("--cameras", nargs="+",
                     default=["+z", "+x", "+y", "iso"])
    exp.add_argument("--resolution", type=int, default=256)
    _add_policy_args(exp)
    return p.parse_args(argv)


def _add_policy_args(parser):
    parser.add_argument("--boundary-policy", choices=["penalize", "lock"],
                        default="penalize")
    parser.add_argument("--seam-policy", choices=["penalize", "lock"],
                        default="penalize")
    parser.add_argument("--boundary-weight", type=float, default=10.0)
    parser.add_argument("--seam-weight", type=float, default=5.0)
    parser.add_argument("--lock-part", action="append", default=[])


def options_from(args) -> SimplifyOptions:
    return SimplifyOptions(
        boundary_policy=args.boundary_policy,
        seam_policy=args.seam_policy,
        boundary_weight=args.boundary_weight,
        seam_weight=args.seam_weight,
        lock_parts=tuple(args.lock_part),
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.cmd == "generate":
        mesh = build_test_mesh()
        write_obj(mesh, args.out)
        print(f"wrote {mesh.num_faces} faces, {mesh.num_vertices} verts "
              f"-> {args.out}")
        return 0

    mesh = load_obj(args.input)
    if args.cmd == "simplify":
        simplifier = Simplifier(mesh, options_from(args))
        target = max(1, int(round(mesh.num_faces * args.ratio)))
        got = simplifier.run_to(target)
        write_obj(mesh, args.output)
        print(json.dumps({
            "input_faces": mesh.num_faces, "target_faces": target,
            "result_faces": got, "rejects": simplifier.reject_reasons,
        }, indent=2))
    elif args.cmd == "lod":
        manifest = build_lod_levels(mesh, args.ratios, args.out_dir,
                                    options_from(args))
        print(json.dumps({
            "levels": [(l["level"], l["report"]["faces"],
                        l["report"]["manifold"], l["report"]["oriented"])
                       for l in manifest["levels"]],
            "manifest": os.path.join(args.out_dir, "manifest.json"),
        }, indent=2))
    elif args.cmd == "experiment":
        from qem_simplify.experiment import run_experiment
        rows, csv_path = run_experiment(
            args.input, args.out_dir, args.ratios, args.cameras,
            args.resolution, tuple(args.lock_part),
            args.seam_policy)
        print(f"wrote {len(rows)} metric rows -> {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
