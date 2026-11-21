#pragma once
#include "renderer_common.h"

// Manages the TAAU compute pass and its persistent history. History textures
// are allocated at the previous internal resolution and kept valid across
// dynamic-resolution changes; a viewport (window) resize only down-weights
// history for one frame instead of discarding it.
class TemporalUpscaler
{
public:
    void Init(ID3D11Device* device);

    void OnWindowResize() { windowResizeFrame_ = true; }
    // Drop all accumulated history (used when the upscaler mode changes).
    void InvalidateHistory()
    {
        hasHistory_ = false;
        ping_ = 0;
        history_[0] = HistorySet{};
        history_[1] = HistorySet{};
    }

    // The current internal linear-depth texture is supplied each frame; the
    // temporal pass copies it into the destination history before the spatial
    // pass reads it.
    void SetCurrentDepthTexture(ID3D11Texture2D* tex) { currentDepthTex_ = tex; }

    void Dispatch(ID3D11DeviceContext* ctx,
                  ID3D11ShaderResourceView* curColor,
                  ID3D11ShaderResourceView* velocity,
                  ID3D11ShaderResourceView* curDepth,
                  ID3D11UnorderedAccessView* outputUav,
                  int renderW, int renderH, int outW, int outH,
                  dx::XMFLOAT2 curJitterPx, dx::XMFLOAT2 prevJitterPx,
                  UpscalerMode mode, const TaaConfig& cfg);

private:
    struct HistorySet
    {
        ComPtr<ID3D11Texture2D> colorTex;
        ComPtr<ID3D11Texture2D> depthTex;
        ComPtr<ID3D11ShaderResourceView> colorSrv;
        ComPtr<ID3D11ShaderResourceView> depthSrv;
        ComPtr<ID3D11UnorderedAccessView> colorUav;
        int width = 0, height = 0;
    };

    void AllocateSet(ID3D11Device* device, HistorySet& s, int w, int h);

    ComPtr<ID3D11ComputeShader> shader_;
    ComPtr<ID3D11SamplerState> sampler_;
    ComPtr<ID3D11Buffer> cbuf_;
    HistorySet history_[2];
    int ping_ = 0;
    bool hasHistory_ = false;
    bool windowResizeFrame_ = false;
    int lastDst_ = 0;
    ID3D11Texture2D* currentDepthTex_ = nullptr;
};
