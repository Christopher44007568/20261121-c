#include "temporal_upscaler.h"
#include <d3dcompiler.h>
#include <cassert>
#include <cstdio>
#include "temporal_upscaler_cb.inl"

void TemporalUpscaler::Init(ID3D11Device* device)
{
    ComPtr<ID3DBlob> blob, errors;
    UINT flags = D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3;
    HRESULT hr = D3DCompileFromFile(
        L"shaders/temporal_cs.hlsl", nullptr, D3D_COMPILE_STANDARD_FILE_INCLUDE,
        "CSMain", "cs_5_0", flags, 0, blob.GetAddressOf(), errors.GetAddressOf());
    if (FAILED(hr) && errors)
        std::printf("TAAU shader error: %s\n", (const char*)errors->GetBufferPointer());
    assert(SUCCEEDED(hr));
    device->CreateComputeShader(blob->GetBufferPointer(), blob->GetBufferSize(),
                                nullptr, shader_.GetAddressOf());

    D3D11_SAMPLER_DESC samp = {};
    samp.Filter = D3D11_FILTER_MIN_MAG_LINEAR_MIP_POINT;
    samp.AddressU = samp.AddressV = samp.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    samp.MaxLOD = D3D11_FLOAT32_MAX;
    device->CreateSamplerState(&samp, sampler_.GetAddressOf());

    D3D11_BUFFER_DESC bd = {};
    bd.ByteWidth = sizeof(TaaCBuffer);
    bd.Usage = D3D11_USAGE_DYNAMIC;
    bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    device->CreateBuffer(&bd, nullptr, cbuf_.GetAddressOf());
}

void TemporalUpscaler::AllocateSet(ID3D11Device* device, HistorySet& s,
                                   int w, int h)
{
    s.width = w;
    s.height = h;
    D3D11_TEXTURE2D_DESC cd = {};
    cd.Width = w; cd.Height = h; cd.MipLevels = 1; cd.ArraySize = 1;
    cd.Format = DXGI_FORMAT_R11G11B10_FLOAT;
    cd.SampleDesc.Count = 1;
    cd.Usage = D3D11_USAGE_DEFAULT;
    cd.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_UNORDERED_ACCESS;
    device->CreateTexture2D(&cd, nullptr, s.colorTex.GetAddressOf());
    device->CreateShaderResourceView(s.colorTex.Get(), nullptr,
                                     s.colorSrv.GetAddressOf());
    device->CreateUnorderedAccessView(s.colorTex.Get(), nullptr,
                                      s.colorUav.GetAddressOf());

    D3D11_TEXTURE2D_DESC dd = cd;
    dd.Format = DXGI_FORMAT_R32_FLOAT;
    device->CreateTexture2D(&dd, nullptr, s.depthTex.GetAddressOf());
    device->CreateShaderResourceView(s.depthTex.Get(), nullptr,
                                     s.depthSrv.GetAddressOf());
}

void TemporalUpscaler::Dispatch(
    ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* curColor,
    ID3D11ShaderResourceView* velocity, ID3D11ShaderResourceView* curDepth,
    ID3D11UnorderedAccessView* outputUav, int renderW, int renderH,
    int outW, int outH, dx::XMFLOAT2 curJitterPx, dx::XMFLOAT2 prevJitterPx,
    UpscalerMode mode, const TaaConfig& cfg)
{
    int src = ping_;
    int dst = 1 - ping_;

    // The destination history always lives at the current internal
    // resolution. Reallocate on the first frame or after a resolution change;
    // the previous set (src) stays alive for this frame's reprojection.
    if (history_[dst].width != renderW || history_[dst].height != renderH)
    {
        history_[dst] = HistorySet{};
        ComPtr<ID3D11Device> device;
        ctx->GetDevice(device.GetAddressOf());
        AllocateSet(device.Get(), history_[dst], renderW, renderH);
    }

    D3D11_MAPPED_SUBRESOURCE mapped;
    ctx->Map(cbuf_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    TaaCBuffer cb = {};
    cb.params = dx::XMFLOAT4(cfg.maxHistoryWeight, cfg.velocityTau,
                             cfg.clipGamma, (float)mode);
    int hw = hasHistory_ ? history_[src].width : renderW;
    int hh = hasHistory_ ? history_[src].height : renderH;
    cb.historySize = dx::XMFLOAT4((float)hw, (float)hh, 0.0f, 0.0f);
    cb.windowResize = dx::XMFLOAT4(windowResizeFrame_ ? 1.0f : 0.0f, 0, 0, 0);
    // Jitters arrive as normalized sub-pixel offsets; convert to current
    // internal-resolution pixel units. The previous jitter was stored for a
    // potentially different render resolution, so rescale it by the history
    // size before expressing it in current pixel units.
    dx::XMFLOAT2 curPx(curJitterPx.x * (float)renderW,
                       curJitterPx.y * (float)renderH);
    dx::XMFLOAT2 prevPx(prevJitterPx.x * (float)hw,
                        prevJitterPx.y * (float)hh);
    cb.jitter = dx::XMFLOAT4(curPx.x, curPx.y, prevPx.x, prevPx.y);
    cb.renderSize = dx::XMFLOAT4((float)renderW, (float)renderH, 0, 0);
    memcpy(mapped.pData, &cb, sizeof(cb));
    ctx->Unmap(cbuf_.Get(), 0);

    auto bindInputs = [&](ID3D11ShaderResourceView* histColor,
                          ID3D11ShaderResourceView* histDepth) {
        ID3D11ShaderResourceView* srvs[5] = {
            curColor, velocity, curDepth, histColor, histDepth
        };
        ctx->CSSetShaderResources(0, 5, srvs);
        ctx->CSSetSamplers(0, 1, sampler_.GetAddressOf());
        ctx->CSSetConstantBuffers(2, 1, cbuf_.GetAddressOf());
        ctx->CSSetShader(shader_.Get(), nullptr, 0);
    };

    if (mode == UpscalerMode::Reference)
    {
        // Full-resolution identity pass into the back buffer UAV.
        bindInputs(curColor, curDepth);
        ctx->CSSetUnorderedAccessViews(0, 1, &outputUav, nullptr);
        ctx->Dispatch((outW + 7) / 8, (outH + 7) / 8, 1);
    }
    else
    {
            ID3D11ShaderResourceView* histColor =
                hasHistory_ ? history_[src].colorSrv.Get() : curColor;
        ID3D11ShaderResourceView* histDepth =
            hasHistory_ ? history_[src].depthSrv.Get() : curDepth;

        if (mode == UpscalerMode::Taau)
        {
            // Pass A: temporal accumulation writes the new low-res history.
            bindInputs(histColor, histDepth);
            // On the first frame histColor aliases curColor (t3); the output
            // UAV is a different texture, so no SRV/UAV hazard is possible.
            ID3D11UnorderedAccessView* histUav = history_[dst].colorUav.Get();
            ctx->CSSetUnorderedAccessViews(0, 1, &histUav, nullptr);
            ctx->Dispatch((renderW + 7) / 8, (renderH + 7) / 8, 1);
            ID3D11UnorderedAccessView* nullUav = nullptr;
            ctx->CSSetUnorderedAccessViews(0, 1, &nullUav, nullptr);
            // The current low-res depth becomes this frame's history depth;
            // do it before Pass B so the spatial pass sees valid data.
            if (currentDepthTex_ != nullptr)
                ctx->CopyResource(history_[dst].depthTex.Get(),
                                  currentDepthTex_);
            lastDst_ = dst;
            ping_ = dst;
            hasHistory_ = true;

            // Pass B: spatial upscale reads the freshly written history.
            ID3D11ShaderResourceView* fresh[5] = {
                curColor, velocity, curDepth,
                history_[dst].colorSrv.Get(),
                history_[dst].depthSrv.Get()
            };
            ctx->CSSetShaderResources(0, 5, fresh);
            ctx->CSSetUnorderedAccessViews(0, 1, &outputUav, nullptr);
            ctx->Dispatch((outW + 7) / 8, (outH + 7) / 8, 1);
        }
        else
        {
            // No-history: Pass A tonemaps into the low-res destination set,
            // Pass B bilinearly upsamples it. No history SRV is consulted
            // because mode != Taau inside the shader.
            bindInputs(curColor, curDepth);
            ID3D11UnorderedAccessView* histUav = history_[dst].colorUav.Get();
            ctx->CSSetUnorderedAccessViews(0, 1, &histUav, nullptr);
            ctx->Dispatch((renderW + 7) / 8, (renderH + 7) / 8, 1);
            ID3D11UnorderedAccessView* nullUav = nullptr;
            ctx->CSSetUnorderedAccessViews(0, 1, &nullUav, nullptr);

            ID3D11ShaderResourceView* fresh[5] = {
                curColor, velocity, curDepth,
                history_[dst].colorSrv.Get(),
                history_[dst].depthSrv.Get()
            };
            ctx->CSSetShaderResources(0, 5, fresh);
            ctx->CSSetUnorderedAccessViews(0, 1, &outputUav, nullptr);
            ctx->Dispatch((outW + 7) / 8, (outH + 7) / 8, 1);
            // No temporal state is retained; leave ping_ and hasHistory_
            // untouched so a later switch to TAAU starts from a clean slate.
        }
    }

    ID3D11UnorderedAccessView* nullUav = nullptr;
    ID3D11ShaderResourceView* nullSrvs[5] = {};
    ctx->CSSetUnorderedAccessViews(0, 1, &nullUav, nullptr);
    ctx->CSSetShaderResources(0, 5, nullSrvs);
    windowResizeFrame_ = false;
}
