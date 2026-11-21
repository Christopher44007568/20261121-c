#include "gpu_timer.h"
#include <cstdio>

void GpuTimer::Init(ID3D11Device* device)
{
    D3D11_QUERY_DESC disjointDesc = {};
    disjointDesc.Query = D3D11_QUERY_TIMESTAMP_DISJOINT;
    D3D11_QUERY_DESC tsDesc = {};
    tsDesc.Query = D3D11_QUERY_TIMESTAMP;
    for (Slot& s : slots_)
    {
        device->CreateQuery(&disjointDesc, s.disjoint.GetAddressOf());
        device->CreateQuery(&tsDesc, s.start.GetAddressOf());
        device->CreateQuery(&tsDesc, s.end.GetAddressOf());
    }
}

void GpuTimer::BeginFrame(ID3D11DeviceContext* ctx)
{
    Slot& s = slots_[cur_];
    ctx->Begin(s.disjoint.Get());
    ctx->End(s.start.Get());
    s.used = true;
}

void GpuTimer::Mark(ID3D11DeviceContext* ctx)
{
    Slot& s = slots_[cur_];
    ctx->End(s.end.Get());
    ctx->End(s.disjoint.Get());
    cur_ = (cur_ + 1) % kFrames;
}

float GpuTimer::GetFrameMs(ID3D11DeviceContext* ctx)
{
    // Read the slot that ended at least one full frame ago.
    int idx = cur_;
    Slot& s = slots_[idx];
    if (!s.used) return 0.0f;

    D3D11_QUERY_DATA_TIMESTAMP_DISJOINT disjoint = {};
    UINT64 t0 = 0, t1 = 0;
    if (ctx->GetData(s.disjoint.Get(), &disjoint, sizeof(disjoint), 0) != S_OK)
        return 0.0f;
    if (disjoint.Disjoint)
        return 0.0f;
    if (ctx->GetData(s.start.Get(), &t0, sizeof(t0), 0) != S_OK ||
        ctx->GetData(s.end.Get(), &t1, sizeof(t1), 0) != S_OK)
        return 0.0f;
    double seconds = double(t1 - t0) / double(disjoint.Frequency);
    return float(seconds * 1000.0);
}
