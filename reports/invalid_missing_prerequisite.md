# Render graph: invalid_missing_prerequisite

Status: FAILED

## Diagnostics

- **ERROR uninitialized-read** pass=`shadow_receiver` resource=`shadow_map`: uninitialized read: pass 'shadow_receiver' reads 'shadow_map' before any pass produces it (missing prerequisite)

## Topological schedule

_No schedule produced._

## Resource lifetimes

| resource | format/extent | bytes | first | last | allocation |
|---|---|---:|---:|---:|---|

## Transitions

_None._

## Allocation plan

_No transient allocations._

- transient request total: 0 B
- peak allocation: 0 B
- reused through aliasing: 0 B
