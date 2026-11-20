# Render graph: shadow

Status: OK

## Topological schedule

0. `shadow_caster` (W:shadow_map)
1. `shadow_receiver` (R:shadow_map W:lit_scene)

## Resource lifetimes

| resource | format/extent | bytes | first | last | allocation |
|---|---|---:|---:|---:|---|
| `shadow_map` | R32_SFLOAT 640x360 | 900.00 KiB | 0 | 1 | block 0 +0x0 |
| `lit_scene` | RGBA16_SFLOAT 640x360 | 1.76 MiB | 1 | 1 | block 0 +0xe1000 |

## Transitions

- pass `shadow_caster` `shadow_map`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `shadow_receiver` `shadow_map`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `shadow_receiver` `lit_scene`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)

## Allocation plan

- memory block 0: 2.64 MiB [shadow_map, lit_scene]

- transient request total: 2.64 MiB
- peak allocation: 2.64 MiB
- reused through aliasing: 0 B
