"""Shared dark-theme figure styling matching the demo report language."""

from __future__ import annotations

import matplotlib as mpl

BG = "#0b1018"
PANEL = "#101722"
GRID = "#233042"
TEXT = "#dce6f2"
MUTED = "#8fa3bd"
ORANGE = "#ff8a5c"
BLUE = "#6aa6ff"
GREEN = "#5fd3b0"
PINK = "#f2728b"
AMBER = "#f2b45c"

PALETTE = [GREEN, BLUE, AMBER, ORANGE, PINK]


def apply() -> None:
    mpl.rcParams.update(
        {
            "figure.facecolor": BG,
            "axes.facecolor": PANEL,
            "savefig.facecolor": BG,
            "axes.edgecolor": GRID,
            "axes.labelcolor": TEXT,
            "axes.titlecolor": TEXT,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "text.color": TEXT,
            "grid.color": GRID,
            "font.family": "DejaVu Sans",
            "font.size": 12,
            "axes.titlesize": 16,
            "axes.labelsize": 13,
            "axes.grid": True,
            "grid.alpha": 0.6,
            "lines.linewidth": 2.2,
        }
    )
