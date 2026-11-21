#include "dx11_context.h"
#include <cassert>

void Dx11Context::Init(HWND hwnd, int w, int h)
{
    width = w;
    height = h;

    DXGI_SWAP_CHAIN_DESC scDesc = {};
    scDesc.BufferCount = 2;
    scDesc.BufferDesc.Width = w;
    scDesc.BufferDesc.Height = h;
    scDesc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    scDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    scDesc.OutputWindow = hwnd;
    scDesc.SampleDesc.Count = 1;
    scDesc.Windowed = TRUE;
    scDesc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    UINT flags = 0;
#if defined(_DEBUG)
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
    D3D_FEATURE_LEVEL featureLevel;
    HRESULT hr = D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0,
        D3D11_SDK_VERSION, &scDesc, swapChain.GetAddressOf(),
        device.GetAddressOf(), &featureLevel, ctx.GetAddressOf());
    assert(SUCCEEDED(hr));

    ComPtr<ID3D11Texture2D> backBuffer;
    swapChain->GetBuffer(0, IID_PPV_ARGS(backBuffer.GetAddressOf()));
    device->CreateRenderTargetView(backBuffer.Get(), nullptr,
                                   backBufferRtv.GetAddressOf());
}

void Dx11Context::Resize(int w, int h)
{
    if (w == width && h == height) return;
    width = w;
    height = h;
    backBufferRtv.Reset();
    swapChain->ResizeBuffers(0, w, h, DXGI_FORMAT_UNKNOWN, 0);

    ComPtr<ID3D11Texture2D> backBuffer;
    swapChain->GetBuffer(0, IID_PPV_ARGS(backBuffer.GetAddressOf()));
    device->CreateRenderTargetView(backBuffer.Get(), nullptr,
                                   backBufferRtv.GetAddressOf());
}

void Dx11Context::Present(int vsync)
{
    swapChain->Present(vsync, 0);
}
