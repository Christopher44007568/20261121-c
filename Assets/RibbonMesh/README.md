# Ribbon Mesh — Closed 3D Curves with Parallel-Transport Frames

A Unity component that builds a width-carrying, asymmetrically textured surface
along a closed three-dimensional spline.

## What it does

- **Closed 3D curve** — centripetal Catmull-Rom spline through cyclic control
  points (`ClosedCatmullRomSpline.cs`). Centripetal parameterization avoids
  cusps and overshoot, and near-coincident control points are handled without
  producing NaNs.
- **Parallel-transport frames** — each ring's normal is carried forward by the
  minimal rotation that maps the old tangent onto the new one
  (`ParallelTransport.cs`). Unlike Frenet frames, the transported normal never
  flips at an inflection point where curvature crosses zero.
- **Residual twist after one loop** — transporting around a closed space curve
  generally leaves a mismatch between the closing normal and the starting
  normal. This signed angle is measured and distributed uniformly over the
  whole loop, so the final ring matches ring 0 exactly and the texture seam
  stays continuous. Toggle `Correct Residual Twist` off to see the raw seam.
- **Width and asymmetric texture** — each control point has a width and a
  width-offset fraction. Geometry shifts off-center while across-width UVs stay
  anchored to `[0,1]`, so the lopsided procedural texture (`RibbonTextureFactory`)
  makes the asymmetry obvious.
- **Real-time updates** — `RibbonMeshComponent` is `[ExecuteAlways]`. Moving a
  control point in the inspector, via a scene handle, or from another script
  rebuilds the mesh immediately, both in play mode and in edit mode.

## Files

- `Runtime/ClosedCatmullRomSpline.cs` — spline evaluation, tangents, scalar channels.
- `Runtime/ParallelTransport.cs` — moving frames and residual-twist correction.
- `Runtime/RibbonMeshBuilder.cs` — dense sampling, equal-arc-length rings, mesh assembly.
- `Runtime/RibbonMeshComponent.cs` — MonoBehaviour, live rebuild, gizmos.
- `Runtime/RibbonTextureFactory.cs` — procedural asymmetric texture.
- `Demo/RibbonDemoSpawner.cs` — three showcase presets.
- `Demo/RibbonDemoBootstrap.cs` — spawns the demos on play start.
- `Editor/RibbonMeshEditor.cs` — menu, diagnostics, draggable control-point handles.
- `Shaders/RibbonUnlitDoubleSided.shader` — double-sided unlit material.

## The three demos

Open or create a scene and run the menu **GameObject > Ribbon Mesh > Create
Demo Ribbons**, or just press Play with a `RibbonDemoBootstrap` in the scene.

1. **HelixLoop** — a winding loop with natural torsion; demonstrates continuous
   normals and texture flow. Symmetric enough that its residual twist is small.
2. **InflectionLoop** — a figure-eight style closed loop whose curvature passes
   through zero. Red scene-view lines show how a Frenet-style normal swings at
   the inflection, while the green transported normal stays smooth. This preset
   has a large measurable residual twist that correction removes at the seam.
3. **NearlyStationaryPoints** — two adjacent control points almost coincide.
   Confirms the spline stays finite, frames stay orthonormal, and the seam
   still closes cleanly.

Green gizmos are transported normals (across the width), blue are surface
normals, and red are Frenet-style comparison normals.

## Validation

The same math is ported to dependency-free Python under `validation/`. Run:

```
python3 validation/test_ribbon.py
```

It checks orthonormal frames, no normal flips, even arc-length spacing,
closing-seam continuity, asymmetric UVs, a measurable residual twist on the
high-torsion loop, and an open seam when correction is disabled.
