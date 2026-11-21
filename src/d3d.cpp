#include "appstate.h"
#include "shaders.h"
#include <d3dcompiler.h>

AppState g;

static void LogHR(const char* what, HRESULT hr) {
    if (FAILED(hr)) fprintf(stderr, "%s failed: hr=0x%08lx\n", what, (unsigned long)hr);
}

bool InitD3D() {
    DXGI_SWAP_CHAIN_DESC sd{};
    sd.BufferCount = 2;
    sd.BufferDesc.Width = g.width;
    sd.BufferDesc.Height = g.height;
    sd.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = g.hwnd;
    sd.SampleDesc.Count = 1;               // MSAA lives in our offscreen target
    sd.Windowed = TRUE;
    sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;

    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT; // required for D2D interop
#ifdef _DEBUG
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
    D3D_FEATURE_LEVEL fl[] = { D3D_FEATURE_LEVEL_11_0 };
    HRESULT hr = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE,
        nullptr, flags, fl, 1, D3D11_SDK_VERSION, &sd, &g.swap, &g.dev, nullptr, &g.ctx);
    if (FAILED(hr)) { // fallback to WARP so the demo still runs anywhere
        hr = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_WARP,
            nullptr, flags, fl, 1, D3D11_SDK_VERSION, &sd, &g.swap, &g.dev, nullptr, &g.ctx);
    }
    LogHR("D3D11CreateDeviceAndSwapChain", hr);
    if (FAILED(hr)) return false;

    hr = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &g.d2dFactory);
    LogHR("D2D1CreateFactory", hr);
    hr = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                             reinterpret_cast<IUnknown**>(&g.dwFactory));
    LogHR("DWriteCreateFactory", hr);
    if (g.dwFactory) {
        g.dwFactory->CreateTextFormat(L"Microsoft YaHei", nullptr,
            DWRITE_FONT_WEIGHT_BOLD, DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL, 16.0f, L"zh-cn", &g.fmtTitle);
        g.dwFactory->CreateTextFormat(L"Microsoft YaHei", nullptr,
            DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL, 13.0f, L"zh-cn", &g.fmtBody);
    }
    return CreateSizeDependentResources();
}

// (Re)creates everything that depends on window size or MSAA count.
bool CreateSizeDependentResources() {
    SafeRelease(g.d2dRT);
    SafeRelease(g.backRTV);
    SafeRelease(g.sceneRTV); SafeRelease(g.sceneTex);
    SafeRelease(g.dsv);      SafeRelease(g.depthTex);

    HRESULT hr = g.swap->ResizeBuffers(0, g.width, g.height,
                                       DXGI_FORMAT_UNKNOWN, 0);
    LogHR("ResizeBuffers", hr);
    if (FAILED(hr)) return false;

    ID3D11Texture2D* back = nullptr;
    hr = g.swap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&back);
    if (FAILED(hr)) { LogHR("GetBuffer", hr); return false; }
    hr = g.dev->CreateRenderTargetView(back, nullptr, &g.backRTV);
    LogHR("CreateRTV(back)", hr);

    // MSAA offscreen scene target
    g.msaaCount = 1; g.msaaQuality = 0;
    if (g.wantMsaa) {
        UINT q = 0;
        if (SUCCEEDED(g.dev->CheckMultisampleQualityLevels(
                DXGI_FORMAT_B8G8R8A8_UNORM, 4, &q)) && q > 0) {
            g.msaaCount = 4; g.msaaQuality = q - 1;
        }
    }
    D3D11_TEXTURE2D_DESC td{};
    td.Width = g.width; td.Height = g.height; td.MipLevels = 1; td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = g.msaaCount; td.SampleDesc.Quality = g.msaaQuality;
    td.Usage = D3D11_USAGE_DEFAULT; td.BindFlags = D3D11_BIND_RENDER_TARGET;
    hr = g.dev->CreateTexture2D(&td, nullptr, &g.sceneTex);
    LogHR("CreateTexture2D(scene)", hr);
    if (FAILED(hr)) { SafeRelease(back); return false; }
    hr = g.dev->CreateRenderTargetView(g.sceneTex, nullptr, &g.sceneRTV);
    LogHR("CreateRTV(scene)", hr);

    td.Format = DXGI_FORMAT_D24_UNORM_S8_UINT;
    td.BindFlags = D3D11_BIND_DEPTH_STENCIL;
    hr = g.dev->CreateTexture2D(&td, nullptr, &g.depthTex);
    LogHR("CreateTexture2D(depth)", hr);
    if (FAILED(hr)) { SafeRelease(back); return false; }
    hr = g.dev->CreateDepthStencilView(g.depthTex, nullptr, &g.dsv);
    LogHR("CreateDSV", hr);

    // D2D target bound to the (non-MSAA) backbuffer for HUD text
    if (g.d2dFactory) {
        IDXGISurface* surf = nullptr;
        back->QueryInterface(__uuidof(IDXGISurface), (void**)&surf);
        auto props = D2D1::RenderTargetProperties(D2D1_RENDER_TARGET_TYPE_DEFAULT,
            D2D1::PixelFormat(DXGI_FORMAT_UNKNOWN, D2D1_ALPHA_MODE_PREMULTIPLIED));
        hr = g.d2dFactory->CreateDxgiSurfaceRenderTarget(surf, &props, &g.d2dRT);
        LogHR("CreateDxgiSurfaceRenderTarget", hr);
        SafeRelease(surf);
    }
    SafeRelease(back);
    return true;
}

typedef HRESULT(WINAPI* D3DCompileFn)(LPCVOID, SIZE_T, LPCSTR, const void*,
    void*, LPCSTR, LPCSTR, UINT, UINT, ID3DBlob**, ID3DBlob**);

static ID3DBlob* CompileShader(const char* entry, const char* target) {
    static D3DCompileFn compileFn = nullptr;
    static bool tried = false;
    if (!tried) {
        tried = true;
        HMODULE dll = LoadLibraryA("d3dcompiler_47.dll");
        if (!dll) dll = LoadLibraryA("d3dcompiler_43.dll");
        if (dll) compileFn = (D3DCompileFn)GetProcAddress(dll, "D3DCompile");
    }
    if (!compileFn) { fprintf(stderr, "D3DCompile not available\n"); return nullptr; }
    ID3DBlob* code = nullptr; ID3DBlob* err = nullptr;
    HRESULT hr = compileFn(kShaderSource, strlen(kShaderSource), "shaders", nullptr,
        nullptr, entry, target,
        D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3, 0,
        &code, &err);
    if (FAILED(hr)) {
        fprintf(stderr, "compile %s: %s\n", entry,
            err ? (const char*)err->GetBufferPointer() : "unknown");
        SafeRelease(err);
        return nullptr;
    }
    SafeRelease(err);
    return code;
}

bool CreatePipelineObjects() {
    ID3DBlob* vsBlob = CompileShader("VSMain", "vs_5_0");
    if (!vsBlob) return false;
    HRESULT hr = g.dev->CreateVertexShader(vsBlob->GetBufferPointer(),
        vsBlob->GetBufferSize(), nullptr, &g.vs);
    LogHR("CreateVertexShader", hr);

    D3D11_INPUT_ELEMENT_DESC il[] = {
        { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0,  D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "NORMAL",   0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 12, D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT,    0, 24, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    };
    hr = g.dev->CreateInputLayout(il, 3, vsBlob->GetBufferPointer(),
        vsBlob->GetBufferSize(), &g.layout);
    LogHR("CreateInputLayout", hr);
    SafeRelease(vsBlob);

    auto makePS = [&](const char* entry, ID3D11PixelShader** out) {
        ID3DBlob* b = CompileShader(entry, "ps_5_0");
        if (!b) return false;
        hr = g.dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(),
            nullptr, out);
        LogHR(entry, hr);
        SafeRelease(b);
        return SUCCEEDED(hr);
    };
    if (!makePS("PSOpaque", &g.psOpaque)) return false;
    if (!makePS("PSHairA2C", &g.psHairA2C)) return false;
    if (!makePS("PSHairClip", &g.psHairClip)) return false;
    if (!makePS("PSHairCoverage", &g.psHairCoverage)) return false;

    D3D11_BUFFER_DESC cbd{};
    cbd.ByteWidth = 208; // 2 mat4 + 3 float4
    cbd.Usage = D3D11_USAGE_DYNAMIC;
    cbd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cbd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    hr = g.dev->CreateBuffer(&cbd, nullptr, &g.cb);
    LogHR("CreateBuffer(cb)", hr);
    if (FAILED(hr)) return false;

    // A2C: alpha -> per-sample coverage mask, plus standard alpha blend
    D3D11_BLEND_DESC bd{};
    bd.AlphaToCoverageEnable = TRUE;
    auto& rt0 = bd.RenderTarget[0];
    rt0.BlendEnable = TRUE;
    rt0.SrcBlend = D3D11_BLEND_SRC_ALPHA;
    rt0.DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    rt0.BlendOp = D3D11_BLEND_OP_ADD;
    rt0.SrcBlendAlpha = D3D11_BLEND_ONE;
    rt0.DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    rt0.BlendOpAlpha = D3D11_BLEND_OP_ADD;
    rt0.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    hr = g.dev->CreateBlendState(&bd, &g.bsA2C);
    LogHR("CreateBlendState(A2C)", hr);
    bd.AlphaToCoverageEnable = FALSE;
    rt0.BlendEnable = FALSE;
    hr = g.dev->CreateBlendState(&bd, &g.bsOpaque);
    LogHR("CreateBlendState(opaque)", hr);

    D3D11_DEPTH_STENCIL_DESC dd{};
    dd.DepthEnable = TRUE;
    dd.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ALL;
    dd.DepthFunc = D3D11_COMPARISON_LESS;
    hr = g.dev->CreateDepthStencilState(&dd, &g.dsOpaque);
    dd.DepthFunc = D3D11_COMPARISON_LESS_EQUAL;
    hr = g.dev->CreateDepthStencilState(&dd, &g.dsHairWrite);
    dd.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ZERO;
    hr = g.dev->CreateDepthStencilState(&dd, &g.dsHairNoWrite);
    LogHR("CreateDepthStencilState", hr);

    D3D11_RASTERIZER_DESC rd{};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_BACK;
    rd.DepthClipEnable = TRUE;
    rd.MultisampleEnable = TRUE;
    rd.ScissorEnable = TRUE;
    hr = g.dev->CreateRasterizerState(&rd, &g.rsBack);
    rd.CullMode = D3D11_CULL_NONE; // hair cards are double-sided
    hr = g.dev->CreateRasterizerState(&rd, &g.rsNone);
    LogHR("CreateRasterizerState", hr);

    D3D11_SAMPLER_DESC sd{};
    sd.Filter = D3D11_FILTER_ANISOTROPIC;
    sd.AddressU = D3D11_TEXTURE_ADDRESS_WRAP;
    sd.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MaxAnisotropy = 4;
    sd.MaxLOD = D3D11_FLOAT32_MAX;
    hr = g.dev->CreateSamplerState(&sd, &g.samp);
    LogHR("CreateSamplerState", hr);
    return SUCCEEDED(hr);
}

void CleanupD3D() {
    SafeRelease(g.fmtTitle); SafeRelease(g.fmtBody);
    SafeRelease(g.d2dRT); SafeRelease(g.d2dFactory); SafeRelease(g.dwFactory);
    SafeRelease(g.sphere.vb); SafeRelease(g.sphere.ib);
    SafeRelease(g.glasses.vb); SafeRelease(g.glasses.ib);
    SafeRelease(g.quad.vb); SafeRelease(g.quad.ib);
    SafeRelease(g.hairSRV); SafeRelease(g.samp);
    SafeRelease(g.rsBack); SafeRelease(g.rsNone);
    SafeRelease(g.dsOpaque); SafeRelease(g.dsHairWrite); SafeRelease(g.dsHairNoWrite);
    SafeRelease(g.bsA2C); SafeRelease(g.bsOpaque);
    SafeRelease(g.cb); SafeRelease(g.layout);
    SafeRelease(g.vs); SafeRelease(g.psOpaque); SafeRelease(g.psHairA2C);
    SafeRelease(g.psHairClip); SafeRelease(g.psHairCoverage);
    SafeRelease(g.sceneRTV); SafeRelease(g.sceneTex);
    SafeRelease(g.dsv); SafeRelease(g.depthTex);
    SafeRelease(g.backRTV); SafeRelease(g.swap);
    if (g.ctx) g.ctx->ClearState();
    SafeRelease(g.ctx); SafeRelease(g.dev);
}
