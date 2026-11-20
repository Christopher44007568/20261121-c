"""Shared helpers: CSV grids, scene model, analytic ray-plate math."""

import csv
import json
import math
import os


def load_grid(path):
    with open(path, newline="") as f:
        return [[float(v) for v in row] for row in csv.reader(f)]


def load_grid_int(path):
    with open(path, newline="") as f:
        return [[int(v) for v in row] for row in csv.reader(f)]


def load_scene(artifacts):
    with open(os.path.join(artifacts, "scene.json")) as f:
        return json.load(f)


def scan_angles(scene):
    az0, az1, naz = scene["azimuth_deg"]
    el0, el1, nel = scene["elevation_deg"]
    azs = [math.radians(az0 + (az1 - az0) * c / (naz - 1)) for c in range(naz)]
    els = [math.radians(el0 + (el1 - el0) * r / (nel - 1)) for r in range(nel)]
    return els, azs


def ray_dir(el, az):
    return (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


class Plate:
    """Yaw-rotated rectangular plate; local frame u (lateral), v (up), n."""

    def __init__(self, spec):
        self.name = spec["name"]
        self.center = tuple(spec["center"])
        self.reflectance = spec["reflectance"]
        self.transmittance = spec["transmittance"]
        self.hw = spec["width"] / 2.0
        self.hh = spec["height"] / 2.0
        yaw = math.radians(spec["yaw_deg"])
        c, s = math.cos(yaw), math.sin(yaw)
        self.u = (c, 0.0, -s)
        self.v = (0.0, 1.0, 0.0)
        self.n = (s, 0.0, c)

    def intersect(self, direction):
        """Return (t, lu, lv) for the ray origin+t*dir, or None if the
        ray misses the finite rectangle."""
        denom = _dot(direction, self.n)
        if abs(denom) < 1e-12:
            return None
        t = _dot(self.center, self.n) / denom  # scanner at origin
        if t <= 0.0:
            return None
        p = (direction[0] * t, direction[1] * t, direction[2] * t)
        rel = _sub(p, self.center)
        lu, lv = _dot(rel, self.u), _dot(rel, self.v)
        if abs(lu) <= self.hw + 1e-9 and abs(lv) <= self.hh + 1e-9:
            return t, lu, lv
        return None

    def cos_incidence(self, direction):
        return abs(_dot(direction, self.n))


def expected_echoes(plates, direction, max_echoes=2):
    """Analytic echo list [(plate_index, t)], mirroring the C++ logic."""
    hits = []
    for i, plate in enumerate(plates):
        hit = plate.intersect(direction)
        if hit is not None:
            hits.append((hit[0], i))
    hits.sort()
    echoes = []
    for t, i in hits:
        echoes.append((i, t))
        if plates[i].transmittance <= 0.0 or len(echoes) == max_echoes:
            break
    return echoes
