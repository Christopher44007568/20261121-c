"""Tiny offline static server for the LOD viewer.

Serves the WebGL page from viewer/static and the mesh assets from a chosen
LOD directory (default report/lod).  Run:  python viewer/serve.py
then open http://127.0.0.1:8123/ in a browser.
"""

from __future__ import annotations

import argparse
import http.server
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "viewer", "static")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, web_root=None, **kwargs):
        self._web_root = web_root
        super().__init__(*args, directory=web_root, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[viewer] " + fmt % args + "\n")


def prepare_web_root(lod_dir: str) -> str:
    web_root = tempfile.mkdtemp(prefix="qem_viewer_")
    for name in os.listdir(STATIC):
        shutil.copy(os.path.join(STATIC, name), os.path.join(web_root, name))
    # copy LOD assets next to the page so relative OBJ paths resolve
    for name in os.listdir(lod_dir):
        shutil.copy(os.path.join(lod_dir, name), os.path.join(web_root, name))
    return web_root


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lod-dir", default=os.path.join(ROOT, "report", "lod"))
    ap.add_argument("--port", type=int, default=8123)
    args = ap.parse_args()
    web_root = prepare_web_root(args.lod_dir)
    handler = lambda *a, **k: Handler(*a, web_root=web_root, **k)
    httpd = http.server.HTTPServer(("127.0.0.1", args.port), handler)
    print(f"serving {args.lod_dir} at http://127.0.0.1:{args.port}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(web_root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
