#pragma once
#include <d3d11.h>
#include <DirectXMath.h>

// CPU-side mirror of the TaaCB constant buffer declared in temporal_cs.hlsl.
struct TaaCBuffer
{
    DirectX::XMFLOAT4 params;       // x maxHistoryWeight, y velocityTau,
                                    // z clipGamma, w mode
    DirectX::XMFLOAT4 historySize;  // xy history width/height
    DirectX::XMFLOAT4 windowResize; // x = 1 on first frame after window resize
    DirectX::XMFLOAT4 jitter;       // xy current px, zw previous px
    DirectX::XMFLOAT4 renderSize;   // xy internal width/height
};
