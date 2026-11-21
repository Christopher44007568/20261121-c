#pragma once

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d2d1.h>
#include <d2d1helper.h>
#include <dwrite.h>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include "mathutil.h"

template <class T> void SafeRelease(T*& p) { if (p) { p->Release(); p = nullptr; } }

struct Mesh {
    ID3D11Buffer* vb = nullptr;
    ID3D11Buffer* ib = nullptr;
    UINT indexCount = 0;
};

struct HairCard {
    Vec3 basePos;
    float baseRotY;
    float tiltX;
    float phase;
};

struct AppState {
    HWND hwnd = nullptr;
    UINT width = 1280, height = 720;

    ID3D11Device* dev = nullptr;
    ID3D11DeviceContext* ctx = nullptr;
    IDXGISwapChain* swap = nullptr;
    ID3D11RenderTargetView* backRTV = nullptr;

    // offscreen scene target (carries the MSAA sample count)
    ID3D11Texture2D* sceneTex = nullptr;
    ID3D11RenderTargetView* sceneRTV = nullptr;
    ID3D11Texture2D* depthTex = nullptr;
    ID3D11DepthStencilView* dsv = nullptr;
    bool wantMsaa = true;
    UINT msaaCount = 1;
    UINT msaaQuality = 0;

    // pipeline
    ID3D11VertexShader* vs = nullptr;
    ID3D11PixelShader* psOpaque = nullptr;
    ID3D11PixelShader* psHairA2C = nullptr;
    ID3D11PixelShader* psHairClip = nullptr;
    ID3D11PixelShader* psHairCoverage = nullptr;
    ID3D11InputLayout* layout = nullptr;
    ID3D11Buffer* cb = nullptr;
    ID3D11BlendState* bsA2C = nullptr;
    ID3D11BlendState* bsOpaque = nullptr;
    ID3D11DepthStencilState* dsOpaque = nullptr;
    ID3D11DepthStencilState* dsHairWrite = nullptr;
    ID3D11DepthStencilState* dsHairNoWrite = nullptr;
    ID3D11RasterizerState* rsBack = nullptr;
    ID3D11RasterizerState* rsNone = nullptr;
    ID3D11SamplerState* samp = nullptr;
    ID3D11ShaderResourceView* hairSRV = nullptr;

    // scene
    Mesh sphere, glasses, quad;
    std::vector<HairCard> cards;

    // D2D / DWrite HUD
    ID2D1Factory* d2dFactory = nullptr;
    ID2D1RenderTarget* d2dRT = nullptr;
    IDWriteFactory* dwFactory = nullptr;
    IDWriteTextFormat* fmtTitle = nullptr;
    IDWriteTextFormat* fmtBody = nullptr;

    // toggles / animation
    bool hairDepthWrite = true;
    bool coverageDebug = false;
    bool paused = false;
    float camSpeed = 0.25f;
    float animTime = 0.0f;
};

extern AppState g;

bool InitD3D();
void CleanupD3D();
bool CreatePipelineObjects();
bool CreateSceneResources();
bool CreateSizeDependentResources();
void RenderFrame();
void UpdateAnimation(float dt);
void DrawHUD();
