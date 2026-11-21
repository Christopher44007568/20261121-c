#pragma once
#include "renderer_common.h"

struct Dx11Context
{
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> ctx;
    ComPtr<IDXGISwapChain> swapChain;
    ComPtr<ID3D11RenderTargetView> backBufferRtv;
    int width = 0;
    int height = 0;

    void Init(HWND hwnd, int w, int h);
    void Resize(int w, int h);
    void Present(int vsync);
};
