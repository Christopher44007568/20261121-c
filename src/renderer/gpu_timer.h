#pragma once
#include "renderer_common.h"

// Per-frame GPU timing with D3D11 disjoint timestamp queries. Two frames are
// kept in flight so GetFrameTime() reads a query that has definitely finished.
class GpuTimer
{
public:
    void Init(ID3D11Device* device);
    void BeginFrame(ID3D11DeviceContext* ctx);
    void Mark(ID3D11DeviceContext* ctx);          // end of timed region
    // Returns the most recent fully-resolved frame time in milliseconds.
    float GetFrameMs(ID3D11DeviceContext* ctx);

private:
    static constexpr int kFrames = 2;
    struct Slot
    {
        ComPtr<ID3D11Query> disjoint;
        ComPtr<ID3D11Query> start;
        ComPtr<ID3D11Query> end;
        bool used = false;
    };
    Slot slots_[kFrames];
    int cur_ = 0;
};
