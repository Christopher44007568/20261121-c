# Render graph: screenshot

Status: OK

## Topological schedule

0. `shadow_caster` (W:shadow_map)
1. `shadow_receiver` (R:shadow_map W:hdr_scene)
2. `bloom_extract` (R:hdr_scene W:bloom_half)
3. `tonemap` (R:hdr_scene R:bloom_half W:ldr_frame)
4. `screenshot_copy` (R:ldr_frame W:screenshot_bytes)

## Resource lifetimes

| resource | format/extent | bytes | first | last | allocation |
|---|---|---:|---:|---:|---|
| `shadow_map` | R32_SFLOAT 640x360 | 900.00 KiB | 0 | 1 | block 0 +0x0 alias bloom_half |
| `hdr_scene` | RGBA16_SFLOAT 640x360 | 1.76 MiB | 1 | 3 | block 0 +0xe1000 |
| `bloom_half` | RGBA16_SFLOAT 320x180 | 450.00 KiB | 2 | 3 | block 0 +0x0 alias shadow_map |
| `ldr_frame` | RGBA8_UNORM 640x360 | 900.00 KiB | 3 | 4 | block 0 +0x2a3000 |
| `screenshot_bytes` | buffer | 900.00 KiB | 4 | 4 | imported |

## Transitions

- pass `shadow_caster` `shadow_map`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `shadow_receiver` `shadow_map`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `shadow_receiver` `hdr_scene`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `bloom_extract` `hdr_scene`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `bloom_extract` `bloom_half`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `tonemap` `bloom_half`: GENERAL -> GENERAL (compute/shader-write -> compute/shader-read)
- pass `tonemap` `ldr_frame`: UNDEFINED -> GENERAL (compute/none -> compute/shader-write)
- pass `screenshot_copy` `ldr_frame`: GENERAL -> TRANSFER_SRC (compute/shader-write -> transfer/transfer-read)

## Allocation plan

- memory block 0: 3.52 MiB [shadow_map, hdr_scene, bloom_half, ldr_frame]

- transient request total: 3.96 MiB
- peak allocation: 3.52 MiB
- reused through aliasing: 450.00 KiB
