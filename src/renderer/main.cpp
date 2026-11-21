#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <fstream>

#include "dx11_context.h"
#include "gpu_timer.h"
#include "pbr_renderer.h"
#include "temporal_upscaler.h"

namespace
{
constexpr int kWidth = 960;
constexpr int kHeight = 540;
constexpr int kFramesPerMode = 200;
constexpr int kWarmup = 20;

Dx11Context gDx;
PbrRenderer gPbr;
TemporalUpscaler gUpscaler;
GpuTimer gTimer;
Scene gScene;
DynamicResolution gDynRes;
TaaConfig gTaaCfg;

UpscalerMode gMode = UpscalerMode::Taau;
UpscalerMode gPrevMode = gMode;
int gFrame = 0;
dx::XMFLOAT2 gPrevJitter(0.0f, 0.0f);
bool gBenchmark = false;
std::ofstream gBenchCsv;
ComPtr<ID3D11UnorderedAccessView> gBackUav;

LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (msg == WM_KEYDOWN)
    {
        if (wp == '1') gMode = UpscalerMode::Reference;
        if (wp == '2') gMode = UpscalerMode::NoHistory;
        if (wp == '3') gMode = UpscalerMode::Taau;
        if (gMode != gPrevMode)
        {
            gUpscaler.InvalidateHistory();
            gPrevMode = gMode;
        }
        if (wp == VK_ESCAPE) PostQuitMessage(0);
    }
    if (msg == WM_SIZE && gDx.device)
    {
        int w = LOWORD(lp), h = HIWORD(lp);
        if (w > 0 && h > 0)
        {
            gDx.Resize(w, h);
            gBackUav.Reset();
            gUpscaler.OnWindowResize();
        }
    }
    return DefWindowProc(h, msg, wp, lp);
}

FrameConstants BuildFrameConstants(int renderW, int renderH,
                                   dx::XMFLOAT2 jitter)
{
    FrameConstants fc = {};
    dx::XMMATRIX view = gScene.View(gFrame);
    dx::XMMATRIX proj = gScene.Projection(renderW, renderH, jitter);
    dx::XMMATRIX vp = dx::XMMatrixMultiply(view, proj);

    dx::XMMATRIX prevView = gScene.View(gFrame - 1);
    dx::XMMATRIX prevProj =
        gScene.Projection(renderW, renderH, gPrevJitter);
    dx::XMMATRIX prevVp = dx::XMMatrixMultiply(prevView, prevProj);

    dx::XMStoreFloat4x4(&fc.viewProj, dx::XMMatrixTranspose(vp));
    dx::XMStoreFloat4x4(&fc.prevViewProj,
                        dx::XMMatrixTranspose(prevVp));
    dx::XMStoreFloat4x4(&fc.invViewProj,
                        dx::XMMatrixTranspose(dx::XMMatrixInverse(nullptr, vp)));
    fc.cameraPos = dx::XMFLOAT4(gScene.cameraPos.x, gScene.cameraPos.y,
                                gScene.cameraPos.z, 1.0f);
    fc.lightDir = dx::XMFLOAT4(-0.55f, 0.85f, -0.35f, 3.2f);
    fc.params = dx::XMFLOAT4(0.0f, (float)gFrame, (float)renderW,
                             (float)renderH);
    fc.jitter = dx::XMFLOAT4(jitter.x, jitter.y,
                             gPrevJitter.x, gPrevJitter.y);
    fc.outputSize = dx::XMFLOAT4((float)kWidth, (float)kHeight,
                                 1.0f / kWidth, 1.0f / kHeight);
    return fc;
}
} // namespace

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR cmdLine, int show)
{
    gBenchmark = cmdLine != nullptr &&
                 wcsstr(cmdLine, L"benchmark") != nullptr;

    WNDCLASS wc = {};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.lpszClassName = L"DynamicResTaau";
    RegisterClass(&wc);
    HWND hwnd = CreateWindowEx(0, wc.lpszClassName,
        L"Dynamic Resolution + TAAU (1=Reference 2=NoHistory 3=TAAU)",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
        kWidth, kHeight + 40, nullptr, nullptr, hInst, nullptr);
    ShowWindow(hwnd, show);

    gDx.Init(hwnd, kWidth, kHeight);
    gPbr.Init(gDx.device.Get());
    gUpscaler.Init(gDx.device.Get());
    gTimer.Init(gDx.device.Get());
    if (gBenchmark)
    {
        gBenchCsv.open("benchmark_gpu.csv");
        gBenchCsv << "frame,mode,resolution_fraction,render_w,render_h,gpu_ms\n";
    }

    MSG msg = {};
    while (msg.message != WM_QUIT)
    {
        if (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE))
        {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
            continue;
        }

        // Benchmark mode: 200 frames per upscaler mode, cycling Reference ->
        // NoHistory -> TAAU, recording the disjoint-timestamp GPU time.
        if (gBenchmark)
        {
            UpscalerMode wanted =
                (UpscalerMode)std::min(2, gFrame / kFramesPerMode);
            if (wanted != gMode)
            {
                gMode = wanted;
                gUpscaler.InvalidateHistory();
            }
            if (gFrame >= 3 * kFramesPerMode)
            {
                gBenchCsv.close();
                break;
            }
        }

        int renderW, renderH;
        if (gMode == UpscalerMode::Reference)
        {
            renderW = gDx.width;
            renderH = gDx.height;
        }
        else
        {
            gDynRes.GetSize(gDx.width, gDx.height, renderW, renderH);
        }

        dx::XMFLOAT2 jitter = JitterOffset(gFrame + 1);
        gPbr.ResizeRenderTargets(gDx.device.Get(), renderW, renderH);

        gTimer.BeginFrame(gDx.ctx.Get());
        FrameConstants fc = BuildFrameConstants(renderW, renderH, jitter);

        // G-buffer pass owns its internal-resolution linear-depth target;
        // no hardware DSV is needed by the temporal pipeline.
        gPbr.Render(gDx.ctx.Get(), gScene, fc, gFrame, nullptr, nullptr);

        // The back buffer needs a UAV for the compute upscaler. It is cached
        // and recreated only after a swap-chain resize.
        ComPtr<ID3D11Texture2D> backBuffer;
        gDx.swapChain->GetBuffer(0, IID_PPV_ARGS(backBuffer.GetAddressOf()));
        if (!gBackUav)
        {
            D3D11_UNORDERED_ACCESS_VIEW_DESC uavDesc = {};
            uavDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
            uavDesc.ViewDimension = D3D11_UAV_DIMENSION_TEXTURE2D;
            gDx.device->CreateUnorderedAccessView(
                backBuffer.Get(), &uavDesc, gBackUav.GetAddressOf());
        }

        gUpscaler.SetCurrentDepthTexture(gPbr.LinearDepthTex());
        gUpscaler.Dispatch(
            gDx.ctx.Get(), gPbr.ColorSrv(), gPbr.VelocitySrv(),
            gPbr.LinearDepthSrv(), gBackUav.Get(), renderW, renderH,
            gDx.width, gDx.height,
            jitter, gPrevJitter, gMode, gTaaCfg);

        gTimer.Mark(gDx.ctx.Get());
        float gpuMs = gTimer.GetFrameMs(gDx.ctx.Get());
        if (gpuMs > 0.0f && gMode != UpscalerMode::Reference)
            gDynRes.Update(gpuMs);
        if (gBenchmark && gBenchCsv && (gFrame % kFramesPerMode) >= kWarmup)
        {
            gBenchCsv << gFrame << "," << (int)gMode << ","
                      << gDynRes.fraction << "," << renderW << ","
                      << renderH << "," << gpuMs << "\n";
        }

        gDx.Present(1);
        gScene.Advance(1.0f / 60.0f);
        gPrevJitter = jitter;
        ++gFrame;

        if (gBenchmark && (gFrame % 60 == 0))
        {
            std::printf("frame %d mode=%d scale=%.2f gpu=%.2fms res=%dx%d\n",
                        gFrame, (int)gMode, gDynRes.fraction, gpuMs,
                        renderW, renderH);
            if (gFrame >= 600) break;
        }
    }
    return 0;
}
