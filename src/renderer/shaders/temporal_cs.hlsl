#include "common.hlsli"

Texture2D<float4>   gCurrentColor : register(t0);
Texture2D<float2>   gVelocity     : register(t1);
Texture2D<float>    gCurrentDepth : register(t2);
Texture2D<float4>   gHistoryColor : register(t3);
Texture2D<float>    gHistoryDepth : register(t4);
SamplerState        gLinearClamp  : register(s0);

RWTexture2D<float4> gOutput       : register(u0);

cbuffer TaaCB : register(b2)
{
    // x maxHistoryWeight, y velocityTau, z clipGamma, w mode
    float4 gTaaParams;
    float4 gHistorySize;   // xy history width/height
    float4 gWindowResize;  // x = 1 on first frame after a window resize
    float4 gTaaJitter;     // xy current jitter px, zw previous jitter px
    float4 gRenderSize;    // xy internal width/height
};

float3 Tonemap(float3 hdr)
{
    float3 m = hdr / (hdr + float3(1.0f, 1.0f, 1.0f));
    float g = 1.0f / 2.2f;
    return float3(pow(saturate(m.x), g), pow(saturate(m.y), g),
                  pow(saturate(m.z), g));
}

float3 LoadCurTonemapped(int2 px)
{
    int w, h;
    gCurrentColor.GetDimensions(w, h);
    px = clamp(px, int2(0, 0), int2(w - 1, h - 1));
    return Tonemap(gCurrentColor[px].rgb);
}

[numthreads(8, 8, 1)]
void CSMain(uint3 dtid : SV_DispatchThreadID)
{
    int outW, outH;
    gOutput.GetDimensions(outW, outH);
    int2 outPx = (int2)dtid.xy;
    if (outPx.x >= outW || outPx.y >= outH) return;

    int lowW, lowH;
    gCurrentColor.GetDimensions(lowW, lowH);
    float2 outUv = (outPx + 0.5f) / float2(outW, outH);
    uint mode = (uint)gTaaParams.w;

    // Reference: full-resolution render, tonemap only.
    if (mode == 0)
    {
        gOutput[outPx] =
            float4(Tonemap(gCurrentColor[outPx].rgb), 1.0f);
        return;
    }

    // Pass B (display-sized target): bilinear upscale the history written by
    // Pass A. No-history mode uses the current frame through a synthetic set.
    if (outW != lowW || outH != lowH)
    {
        // Both buffers cover the same viewport, so normalized UVs are
        // identical; the bilinear sampler resolves the lower texel density.
        gOutput[outPx] = float4(
            gHistoryColor.SampleLevel(gLinearClamp, outUv, 0).rgb, 1.0f);
        return;
    }

    // Pass A: internal-resolution target. TAAU accumulates history; the
    // no-history path just tonemaps the current frame into the same texture.
    int2 lowPx = outPx;
    float3 cur = Tonemap(gCurrentColor[lowPx].rgb);
    float3 result = cur;

    if (mode == 2)
    {
        float curDepth = gCurrentDepth[lowPx];
        float2 vel = gVelocity[lowPx];
        float velMag = length(vel);

        float nbrVel = 0.0f;
        [unroll]
        for (int dy = -1; dy <= 1; ++dy)
            [unroll]
            for (int dx = -1; dx <= 1; ++dx)
            {
                int2 n = clamp(lowPx + int2(dx, dy), int2(0, 0),
                               int2(lowW - 1, lowH - 1));
                nbrVel = max(nbrVel, length(gVelocity[n]));
            }

        float2 histScale, histBias;
        int histW = (int)gHistorySize.x, histH = (int)gHistorySize.y;
        ResizeScaleBias(histW, histH, lowW, lowH, histScale, histBias);

        float2 reproPx = ReprojectPixel((float2)lowPx, gTaaJitter.xy,
                                        vel, gTaaJitter.zw);
        float2 reproUv = (reproPx + 0.5f) / float2(lowW, lowH);
        reproUv = RemapUv(reproUv, histScale, histBias);

        float confidence = 0.0f;
        float3 history = float3(0.0f, 0.0f, 0.0f);
        if (all(reproUv >= 0.0f) && all(reproUv <= 1.0f))
        {
            history = gHistoryColor.SampleLevel(gLinearClamp, reproUv, 0).rgb;
            float historyDepth =
                gHistoryDepth.SampleLevel(gLinearClamp, reproUv, 0);
            float refDepth = curDepth >= 999.0f ? 1.0f : curDepth;
            float depthDelta =
                (curDepth >= 999.0f && historyDepth >= 999.0f)
                    ? 0.0f : abs(curDepth - historyDepth);
            confidence = HistoryConfidence(reproUv, velMag, nbrVel,
                                           depthDelta, refDepth);
            confidence *= gWindowResize.x > 0.5f ? 0.25f : 1.0f;
        }

        if (confidence > 0.0f)
        {
            Neighborhood nb = MakeNeighborhood(
                cur,
                LoadCurTonemapped(lowPx + int2(-1, 0)),
                LoadCurTonemapped(lowPx + int2(1, 0)),
                LoadCurTonemapped(lowPx + int2(0, -1)),
                LoadCurTonemapped(lowPx + int2(0, 1)),
                LoadCurTonemapped(lowPx + int2(-1, -1)),
                LoadCurTonemapped(lowPx + int2(1, -1)),
                LoadCurTonemapped(lowPx + int2(-1, 1)),
                LoadCurTonemapped(lowPx + int2(1, 1)));
            history = ClipToAabb(history, nb, gTaaParams.z);
            float alpha = TemporalAlpha(confidence, velMag, Luma(cur),
                                        Luma(history), gTaaParams.x,
                                        gTaaParams.y);
            result = cur * alpha + history * (1.0f - alpha);
        }
    }

    gOutput[lowPx] = float4(result, 1.0f);
}
