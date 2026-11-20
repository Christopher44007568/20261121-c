# Render graph: postprocess

Status: OK

## Topological schedule

0. `scene_lighting` (W:hdr_scene)
1. `bloom_extract` (R:hdr_scene W:bloom_half)
2. `tonemap` (R:hdr_scene R:bloom_half W:ldr_frame)

## Resource lifetimes

| resource | format/extent | bytes | first | last | allocation |
|---|---|---:|---:|---:|---|
| `hdr_scene` | RGBA16_SFLOAT 640x360 | 1.76 MiB | 0 | 2 | block 0 +0x0 |
| `bloom_half` | RGBA16_SFLOAT 320x180 | 450.00 KiB | 1 | 2 | block 0 +0x1c2000 |
| `ldr_frame` | RGBA8_UNORM 640x360 | 900.00 KiB | 2 | 2 | block 0 +0x232800 |

## Transitions

- pass `scene_lighting` `hdr_scene`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `bloom_extract` `hdr_scene`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `bloom_extract` `bloom_half`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `tonemap` `bloom_half`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `tonemap` `ldr_frame`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)

## Allocation plan

- memory block 0: 3.08 MiB [hdr_scene, bloom_half, ldr_frame]

- transient request total: 3.08 MiB
- peak allocation: 3.08 MiB
- reused through aliasing: 0 B
