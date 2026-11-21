"""Command line interface for the SH baker and offline viewer generator."""

import argparse
import os
import sys

from . import bake, scenes, coefio
from .imageio import save


def _workers(value):
    return bake.default_workers() if value is None else max(1, value)


def cmd_bake(args):
    workers = _workers(args.workers)
    if args.layout == "equirect":
        coefs, weight = bake.load_equirect(args.input, workers)
        from .imageio import load as _load
        img = _load(args.input)
        resolution = (img.height, img.width)
    else:
        coefs, weight = bake.load_cubemap(args.input, workers)
        resolution = (6, _face_size(args.input), _face_size(args.input))
    coefio.save_shbake_v1(args.output, coefs, args.layout, resolution, weight)
    print(f"baked {args.input} ({args.layout}) -> {args.output}")
    print(f"solid angle sum = {weight:.12f} (4pi = {4 * 3.141592653589793:.12f})")


def cmd_synth(args):
    scene = scenes.SCENES[args.scene]()
    workers = _workers(args.workers)
    os.makedirs(args.outdir, exist_ok=True)
    if args.layout == "equirect":
        img = scenes.rasterize_equirect(scene, args.width, args.width // 2)
        map_path = os.path.join(args.outdir, f"{args.scene}_equirect_{args.width}.ppm")
        save(map_path, img)
        coefs, weight = bake.bake_equirect(img, workers)
    else:
        faces = scenes.rasterize_cubemap(scene, args.size)
        strip = scenes.cubemap_strip(faces)
        map_path = os.path.join(args.outdir, f"{args.scene}_cubemap_{args.size}.ppm")
        save(map_path, strip)
        coefs, weight = bake.bake_cubemap(faces, workers)
    if args.layout == "equirect":
        resolution = (args.width // 2, args.width)
    else:
        resolution = (6, args.size, args.size)
    coef_path = os.path.join(args.outdir, f"{args.scene}_{args.layout}.sh3.json")
    coefio.save_shbake_v1(coef_path, coefs, args.layout, resolution, weight)
    print(f"wrote {map_path}")
    print(f"wrote {coef_path}")


def _face_size(path):
    from .imageio import load as _load
    img = _load(path)
    return img.height if img.width == 6 * img.height else img.width


def cmd_view(args):
    from .viewer import build_viewer
    coefs, payload = coefio.load_coefs(args.coefs)
    html = build_viewer(payload)
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"offline viewer written to {args.output}")


def cmd_validate(args):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, root)
    from tests import run_validation
    run_validation.main()


def build_parser():
    p = argparse.ArgumentParser(prog="shbake",
                                description="Bake env maps to 3-band SH and view them.")
    sub = p.add_subparsers(dest="command", required=True)

    b = sub.add_parser("bake", help="bake an image to SH coefficients")
    b.add_argument("input")
    b.add_argument("output")
    b.add_argument("--layout", choices=["equirect", "cubemap"], default="equirect")
    b.add_argument("--workers", type=int, default=None)
    b.set_defaults(func=cmd_bake)

    s = sub.add_parser("synth", help="synthesize a validation scene and bake it")
    s.add_argument("scene", choices=list(scenes.SCENES))
    s.add_argument("--layout", choices=["equirect", "cubemap"], default="equirect")
    s.add_argument("--width", type=int, default=512)
    s.add_argument("--size", type=int, default=64)
    s.add_argument("--outdir", default="artifacts")
    s.add_argument("--workers", type=int, default=None)
    s.set_defaults(func=cmd_synth)

    v = sub.add_parser("view", help="emit a self-contained WebGL2 viewer HTML")
    v.add_argument("coefs")
    v.add_argument("output")
    v.set_defaults(func=cmd_view)

    val = sub.add_parser("validate", help="run the full numeric validation suite")
    val.set_defaults(func=cmd_validate)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
