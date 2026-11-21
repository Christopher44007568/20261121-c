#include "appstate.h"

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    case WM_SIZE: {
        UINT w = LOWORD(lp), h = HIWORD(lp);
        if (w && h && g.dev && (w != g.width || h != g.height)) {
            g.width = w; g.height = h;
            CreateSizeDependentResources();
        }
        return 0;
    }
    case WM_KEYDOWN:
        switch (wp) {
        case VK_ESCAPE: PostQuitMessage(0); break;
        case 'M':
            g.wantMsaa = !g.wantMsaa;
            CreateSizeDependentResources();
            break;
        case 'D': g.hairDepthWrite = !g.hairDepthWrite; break;
        case 'C': g.coverageDebug = !g.coverageDebug; break;
        case VK_SPACE: g.paused = !g.paused; break;
        case VK_UP:   g.camSpeed = g.camSpeed + 0.05f > 2.0f ? 2.0f : g.camSpeed + 0.05f; break;
        case VK_DOWN: g.camSpeed = g.camSpeed - 0.05f < 0.0f ? 0.0f : g.camSpeed - 0.05f; break;
        }
        return 0;
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show) {
    WNDCLASSEX wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.lpszClassName = L"HairA2CDemo";
    RegisterClassEx(&wc);

    RECT rc{ 0, 0, (LONG)g.width, (LONG)g.height };
    AdjustWindowRect(&rc, WS_OVERLAPPEDWINDOW, FALSE);
    g.hwnd = CreateWindowEx(0, wc.lpszClassName,
        L"Hair A2C vs Alpha-Test — DX11 (M=MSAA D=Depth C=Coverage)",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
        rc.right - rc.left, rc.bottom - rc.top,
        nullptr, nullptr, inst, nullptr);
    if (!g.hwnd) return 1;
    ShowWindow(g.hwnd, show);

    if (!InitD3D() || !CreatePipelineObjects() || !CreateSceneResources()) {
        MessageBox(g.hwnd, L"D3D11 init failed", L"HairA2CDemo", MB_ICONERROR);
        CleanupD3D();
        return 1;
    }

    LARGE_INTEGER freq, prev;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&prev);

    MSG msg{};
    while (msg.message != WM_QUIT) {
        if (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        } else {
            LARGE_INTEGER now;
            QueryPerformanceCounter(&now);
            float dt = (float)(now.QuadPart - prev.QuadPart) / (float)freq.QuadPart;
            prev = now;
            if (dt > 0.1f) dt = 0.1f;
            UpdateAnimation(dt);
            RenderFrame();
        }
    }
    CleanupD3D();
    return (int)msg.wParam;
}
