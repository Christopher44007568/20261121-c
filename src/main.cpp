// Win32 entry point for the DX12 SSR demo.
// Keys:  Space = switch orbit/dolly path,  D = toggle debug overlay,
//        Esc = quit.
#include "SsrRenderer.h"
#include <windows.h>

static SsrRenderer* g_renderer=nullptr;

LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp){
    switch(msg){
    case WM_KEYDOWN:
        if(wp==VK_ESCAPE) PostQuitMessage(0);
        else if(wp==VK_SPACE) g_renderer->TogglePath();
        else if(wp=='D') g_renderer->ToggleDebug();
        return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProc(h,msg,wp,lp);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show){
    WNDCLASSW wc{}; wc.lpfnWndProc=WndProc; wc.hInstance=inst;
    wc.lpszClassName=L"SsrDemoWindow"; wc.hCursor=LoadCursor(nullptr,IDC_ARROW);
    RegisterClassW(&wc);
    SsrSettings s; s.width=1280; s.height=720;
    RECT rc{0,0,s.width,s.height};
    AdjustWindowRect(&rc,WS_OVERLAPPEDWINDOW,FALSE);
    HWND hwnd=CreateWindowW(wc.lpszClassName,L"DX12 Screen-Space Reflection",
        WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,
        rc.right-rc.left,rc.bottom-rc.top,nullptr,nullptr,inst,nullptr);
    ShowWindow(hwnd,show);
    SsrRenderer renderer; g_renderer=&renderer;
    if(!renderer.Initialize(hwnd,s)) return 1;
    MSG msg{}; int frame=0;
    while(msg.message!=WM_QUIT){
        if(PeekMessage(&msg,nullptr,0,0,PM_REMOVE)){
            TranslateMessage(&msg); DispatchMessage(&msg);
        } else {
            renderer.RenderFrame(frame++);
        }
    }
    renderer.Shutdown();
    return 0;
}
