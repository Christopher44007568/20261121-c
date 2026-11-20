"""Level-of-detail pipeline: run one simplification and snapshot at targets.

A single Simplifier instance collapses monotonically; after every target
face count is reached the live mesh is deep-copied, verified and written to
OBJ.  A JSON manifest collects per-level statistics and constraint checks.
"""

from __future__ import annotations

import copy
import json
import os

from .checks import (classify_constraint_edges, full_report,
                     verify_constraints)
from .io import write_obj
from .simplifier import Simplifier, SimplifyOptions


def snapshot_mesh(mesh):
    """Deep copy of the mutable mesh state for an LOD level."""
    m = copy.deepcopy(mesh)
    m.edge_faces = dict(m.edge_faces)
    return m


def build_lod_levels(source_mesh, ratios, out_dir, options=None,
                     prefix="lod"):
    options = options or SimplifyOptions()
    os.makedirs(out_dir, exist_ok=True)
    # never mutate the caller's mesh: collapse a private copy
    source_mesh = copy.deepcopy(source_mesh)
    original = snapshot_mesh(source_mesh)
    orig_buckets = classify_constraint_edges(original)
    lock_part_ids = {i for i, p in enumerate(original.parts)
                     if p in set(options.lock_parts)}
    part_locked = [
        k for k, fs in original.edge_faces.items()
        if fs and all(int(original.face_part[f]) in lock_part_ids
                      for f in fs)]
    locked_keys = sorted(set(orig_buckets["hard"]) | set(part_locked))
    if options.seam_policy == "lock":
        locked_keys = sorted(set(locked_keys) | set(orig_buckets["seam"]))
    if options.boundary_policy == "lock":
        locked_keys = sorted(set(locked_keys)
                             | set(orig_buckets["boundary"]))

    simplifier = Simplifier(source_mesh, options)
    base_faces = source_mesh.num_faces
    levels = []
    targets = sorted(set([1.0] + list(ratios)), reverse=True)
    for level, ratio in enumerate(targets):
        target_faces = max(1, int(round(base_faces * ratio)))
        if ratio < 1.0:
            simplifier.run_to(target_faces)
        snap = snapshot_mesh(source_mesh)
        name = f"{prefix}_{level}_{snap.face_alive.sum()}f"
        obj_path = os.path.join(out_dir, name + ".obj")
        write_obj(snap, obj_path)
        report = full_report(snap)
        constraints = verify_constraints(original, snap, locked_keys)
        seam_left = sum(1 for k in orig_buckets["seam"]
                        if k in set(snap.edge_faces))
        hard_left = sum(1 for k in orig_buckets["hard"]
                        if k in set(snap.edge_faces))
        levels.append({
            "level": level,
            "target_ratio": round(ratio, 4),
            "target_faces": target_faces,
            "obj": os.path.relpath(obj_path),
            "report": report,
            "constraints": constraints,
            "seam_edges_remaining": seam_left,
            "hard_edges_remaining": hard_left,
            "max_quadric_error": max(
                (r.error for r in simplifier.history), default=0.0),
        })
    manifest = {
        "source_faces": base_faces,
        "source_vertices": original.num_vertices,
        "materials": original.materials,
        "parts": original.parts,
        "options": {
            "boundary_policy": options.boundary_policy,
            "seam_policy": options.seam_policy,
            "boundary_weight": options.boundary_weight,
            "seam_weight": options.seam_weight,
            "lock_parts": list(options.lock_parts),
        },
        "original_constraint_counts":
            {k: len(v) for k, v in orig_buckets.items()},
        "levels": levels,
        "reject_reasons": simplifier.reject_reasons,
        "total_collapses": len(simplifier.history),
    }
    with open(os.path.join(out_dir, "manifest.json"), "w",
              encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest
