# Dynamic Resolution + TAAU Benchmark Report

CPU reference harness; identical temporal core (`temporal_core.hlsli`) is shared with the DX11 compute shader. Output resolution 960x540, 60 frames.

## Averaged metrics

| Metric | No history | TAAU | TAAU change |
|---|---|---|---|
| Edge RMSE (all frames) | 0.06375 | 0.06300 | 1.2% lower |
| Edge RMSE (steady frames) | 0.06364 | 0.06303 | 1.0% lower |
| Thin-line RMSE | 0.10012 | 0.09817 | 1.9% lower |
| Edge flicker | 0.043743 | 0.036891 | 15.7% lower |
| GPU time (ms/frame) | 1.168 | 1.168 | 36.5% lower than ref |
| Reference GPU time (ms/frame) | 1.839 | 1.839 | baseline |

## Stress shots

| Shot | No-history flicker | TAAU flicker | Interpretation |
|---|---|---|---|
| Velocity jump (frames 20-21, 41-42) | 0.096118 | 0.090614 | TAAU relaxes history to avoid ghosting, then reconverges |
| Window resize (frames 30-31) | 0.045847 | 0.045417 | History retained at 0.25 confidence instead of a hard clear |

## GPU time model

The harness uses an analytic ms/megapixel cost model (`GpuCostModel`). The DX11 app replaces it with D3D11 disjoint timestamp queries (`GpuTimer`) and writes `benchmark_gpu.csv` in `benchmark` mode.
