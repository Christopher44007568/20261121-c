// D3D12 renderer that runs the SSR pipeline:
//   G-buffer -> linear-depth Hi-Z pyramid -> SSR resolve -> temporal
//   accumulation (with history invalidation) -> composite to the swapchain.
// The algorithm mirrors reference/ssr_* and shaders/*.hlsl.
#pragma once
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl.h>
#include <DirectXMath.h>
#include <vector>
#include <string>
#include "Scene.h"
#include "CameraPaths.h"

using Microsoft::WRL::ComPtr;

// CPU mirror of CameraCB in shaders/Common.hlsli (all float4 / row-major).
struct CameraCBPOD {
    DirectX::XMFLOAT4X4 view;
    DirectX::XMFLOAT4X4 proj;
    DirectX::XMFLOAT4X4 viewProj;
    DirectX::XMFLOAT4X4 invProj;
    DirectX::XMFLOAT4X4 prevViewProj;
    DirectX::XMFLOAT4 cameraEye;   // xyz eye, w aspect
    DirectX::XMFLOAT4 params;      // x tanHalfFovY, y time, z pathIndex, w frameIndex
};

struct SsrSettings {
    int   width=1280;
    int   height=720;
    float thickness=0.35f;
    float maxRayDistance=14.0f;
    int   maxSteps=160;
    bool  showDebug=false;          // confidence / fallback overlay
    int   pathIndex=0;              // 0 orbit, 1 dolly
    int   frameCount=240;           // demo length before looping
};

class SsrRenderer {
public:
    SsrRenderer()=default;
    bool Initialize(HWND hwnd, const SsrSettings& s);
    void RenderFrame(int frameIndex);
    void TogglePath();
    void ToggleDebug();
    void Shutdown();

private:
    void CreateDeviceAndSwapChain(HWND hwnd);
    void CreateResources();
    void CreatePipelines();
    void UpdateCamera(int frameIndex);
    void GBufferPass(ID3D12GraphicsCommandList* cl);
    void BuildHiZ(ID3D12GraphicsCommandList* cl);
    void ResolveSSR(ID3D12GraphicsCommandList* cl);
    void TemporalPass(ID3D12GraphicsCommandList* cl);
    void Composite(ID3D12GraphicsCommandList* cl);

    SsrSettings settings_;
    ComPtr<ID3D12Device> device_;
    ComPtr<IDXGIFactory4> factory_;
    ComPtr<ID3D12CommandQueue> queue_;
    ComPtr<IDXGISwapChain3> swap_;
    ComPtr<ID3D12DescriptorHeap> rtvHeap_, cbvSrvHeap_;
    UINT rtvDescSize_=0, srvDescSize_=0;
    ComPtr<ID3D12Resource> swapRTV_[2];
    int hizWidth_[16]{}, hizHeight_[16];
    ComPtr<ID3D12CommandAllocator> alloc_;
    ComPtr<ID3D12GraphicsCommandList> cl_;
    ComPtr<ID3D12Fence> fence_;
    HANDLE fenceEvent_=nullptr;
    UINT64 fenceValue_=0;
    UINT bufferCount_=2, frameIndex_=0;

    // Scene geometry
    MeshData scene_;
    ComPtr<ID3D12Resource> vertexBuf_, indexBuf_;
    D3D12_VERTEX_BUFFER_VIEW vbv_{};
    D3D12_INDEX_BUFFER_VIEW ibv_{};
    UINT indexCount_=0;

    // G-buffer targets and Hi-Z pyramid
    std::vector<ComPtr<ID3D12Resource>> gTargets_;   // MRT 0..5
    std::vector<ComPtr<ID3D12Resource>> hizLevels_;
    ComPtr<ID3D12Resource> ssrColor_, ssrDebug_;
    ComPtr<ID3D12Resource> histColor_[2], histMeta_[2];
    ComPtr<ID3D12Resource> cameraCB_;
    ComPtr<ID3D12RootSignature> rootSigGBuffer_, rootSigCompute_;
    ComPtr<ID3D12PipelineState> psoGBuffer_, psoHiZ_, psoResolve_, psoTemporal_, psoComposite_;
    std::vector<CameraPath> paths_;
};
