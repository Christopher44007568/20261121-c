# HDRP Screen-Space Subsurface Scattering Demo

Unity 2022.3 LTS + HDRP 14 custom material and custom pass implementing
screen-space subsurface scattering from a three-lobe separated diffusion
profile, with strict material-ID isolation and Beer-Lambert thickness.

## What is implemented

- `Assets/Shaders/SSSMaterial.shader` / `.hlsl` — custom HDRP material with
  two passes:
  - `SSSBeauty` writes direct diffuse + specular radiance.
  - `SSSIDThickness` writes quantised material ID in R and world-space
    thickness in G/B.
- `Assets/Shaders/SSSDiffusion.shader` / `.hlsl` — full-screen custom pass
  with two separable 48-tap axes (a 96-tap diffusion footprint):
  - world-space profile radii are converted to pixels per fragment from the
    camera projection, so footprint scales correctly with world scale;
  - every tap is gated on `sampleID == centreID`, so adjacent geometry with
    different material IDs never diffuse into each other;
  - composite applies `exp(-thickness / meanFreePath)` so the 0.45–2.4 mm
    auricle keeps a strong red response while the 40 mm backing plate is
    effectively opaque to the diffuse pass.
- `Assets/Shaders/SSSProfile.hlsl` — three-lobe profile constants, mean free
  path, separable-kernel calibration and transmission helper.
- `Assets/Scripts/SSSDiffusionPass.cs` — HDRP `CustomPass` allocating the
  beauty / ID-thickness / scratch targets and driving all three passes.
- `Assets/Scripts/SSSSceneBootstrap.cs`, `AuricleMeshBuilder.cs`,
  `EdgeCardBuilder.cs` — procedural scene: thin auricle shell (ID 1),
  40 mm backing plate (ID 2), and two zero-gap edge cards (IDs 3 and 4).
- `Assets/Scripts/SSSEdgeMeasurement.cs` — captures the hard light edge,
  measures the 10–90 radius in pixels and converts it to world millimetres.

## How to open

1. Open `UnitySSSDemo/` in Unity 2022.3.20f1 or newer 2022.3 patch release.
2. Assign an HDRP render pipeline asset (Edit > Project Settings > Graphics).
3. Use the menu:
   - `SSS Demo > Build Auricle Scene` for the ear/plate hero scene;
   - `SSS Demo > Build Edge Measurement Scene` for the hard-edge rig;
   - `SSS Demo > Run Edge Measurement Sweep` to write the measurement CSV.
4. Toggle `sssEnabled`, `idGateEnabled`, `radiusScale` and `debugView` on the
   `SSSDiffusionPass` component to compare states live.

## Measurement definition

`radius_px = (x10 − x90) / 2` on the dark side of a hard light edge, with the
camera law

`pixels_per_m = H / (2 · d · tan(FovY / 2))`.

At 720p, 30° vertical FOV and 336 mm camera distance the red-channel effective
radius is 3.157 mm and the analytic 10–90 radius is 13.02 px / 3.256 mm.
