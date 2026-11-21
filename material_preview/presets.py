"""Named material presets used by the previewer."""

from __future__ import annotations

from dataclasses import replace

from .materials import ClearCoat, Material, SpecLobe


def primer() -> Material:
    """Isotropic dielectric primer: rough GGX highlight over a matte base."""
    return Material(
        name="isotropic_primer",
        albedo=(0.55, 0.16, 0.12),
        lobes=(SpecLobe(f0=(0.04, 0.04, 0.04), alpha=0.35, label="binder"),),
    )


def flake_base() -> Material:
    """Binder with embedded metal flakes: broad binder lobe + tight metallic lobe.

    The flake lobe uses a chromatic metallic F0 (silvery aluminium tinted
    toward the red paint) and a much smaller alpha, so its highlight is
    narrow and angle-sensitive.
    """
    binder = SpecLobe(f0=(0.04, 0.04, 0.04), alpha=0.25, weight=0.7,
                      label="binder")
    flakes = SpecLobe(f0=(0.82, 0.78, 0.70), alpha=0.05, weight=0.6,
                      label="metal_flakes")
    return Material(
        name="metal_flake_base",
        albedo=(0.32, 0.09, 0.07),
        lobes=(binder, flakes),
    )


def with_clearcoat(material: Material, ior: float = 1.5,
                   alpha: float = 0.02) -> Material:
    """Return a copy of ``material`` covered by a transparent clearcoat."""
    return replace(material, name=material.name + "_clearcoated",
                   clearcoat=ClearCoat(ior=ior, alpha=alpha))


def preset_stack() -> list[Material]:
    """All compared materials, each exposed with and without clearcoat."""
    bases = [primer(), flake_base()]
    out: list[Material] = []
    for base in bases:
        out.append(base)
        out.append(with_clearcoat(base))
    return out
