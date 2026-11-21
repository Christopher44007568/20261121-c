"""Painted-area and connected-partition statistics."""

from __future__ import annotations

import numpy as np


def painted_area_by_component(mesh, layer) -> dict[int, float]:
    """Sum painted face area within each connected component."""
    labels = mesh.connected_components()
    quality = mesh.quality()
    totals: dict[int, float] = {}
    painted = layer.face_paint > 0.0
    for face_id in np.flatnonzero(painted):
        label = int(labels[face_id])
        totals[label] = totals.get(label, 0.0) + float(
            quality.area[face_id])
    return dict(sorted(totals.items()))


def painted_face_count(layer) -> int:
    return int(np.count_nonzero(layer.face_paint > 0.0))


def sliver_painted_faces(mesh, layer, threshold: float = 12.0):
    quality = mesh.quality(threshold)
    mask = quality.is_sliver & (layer.face_paint > 0.0)
    return np.flatnonzero(mask).astype(int).tolist()


def fraction_painted(mesh, layer) -> float:
    quality = mesh.quality()
    total = float(quality.area.sum())
    if total <= 0.0:
        return 0.0
    painted = float(quality.area[layer.face_paint > 0.0].sum())
    return painted / total
