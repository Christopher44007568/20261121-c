#include "pbr_renderer.h"
#include <algorithm>
#include <d3dcompiler.h>
#include <cassert>
#include <cstdio>
#include <vector>

namespace
{
struct Vertex { dx::XMFLOAT3 pos; dx::XMFLOAT3 normal; };

std::vector<Vertex> BuildSphere(int latBands, int lonBands)
{
    std::vector<Vertex> verts;
    for (int y = 0; y <= latBands; ++y)
    {
        float v = (float)y / latBands;
        float phi = v * 3.14159265f;
        for (int x = 0; x <= lonBands; ++x)
        {
            float u = (float)x / lonBands;
            float theta = u * 2.0f * 3.14159265f;
            dx::XMFLOAT3 n(sinf(phi) * cosf(theta), cosf(phi),
                           sinf(phi) * sinf(theta));
            verts.push_back({ n, n });
        }
    }
    return verts;
}

// Two triangles forming a large ground plane at y = -1.
std::vector<Vertex> BuildGround()
{
    const float s = 30.0f;
    dx::XMFLOAT3 up(0.0f, 1.0f, 0.0f);
    return {
        { { -s, -1.0f, -s }, up }, { {  s, -1.0f, -s }, up },
        { {  s, -1.0f,  s }, up },
        { { -s, -1.0f, -s }, up }, { {  s, -1.0f,  s }, up },
        { { -s, -1.0f,  s }, up }
    };
}

std::vector<uint16_t> BuildSphereIndices(int latBands, int lonBands)
{
    std::vector<uint16_t> idx;
    int row = lonBands + 1;
    for (int y = 0; y < latBands; ++y)
    {
        for (int x = 0; x < lonBands; ++x)
        {
            uint16_t a = (uint16_t)(y * row + x);
            uint16_t b = (uint16_t)(a + row);
            idx.push_back(a); idx.push_back(b); idx.push_back((uint16_t)(a + 1));
            idx.push_back((uint16_t)(a + 1)); idx.push_back(b);
            idx.push_back((uint16_t)(b + 1));
        }
    }
    return idx;
}

ComPtr<ID3DBlob> Compile(const wchar_t* path, const char* entry,
                         const char* target)
{
    ComPtr<ID3DBlob> blob, errors;
    UINT flags = D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3;
    HRESULT hr = D3DCompileFromFile(
        path, nullptr, D3D_COMPILE_STANDARD_FILE_INCLUDE, entry, target,
        flags, 0, blob.GetAddressOf(), errors.GetAddressOf());
    if (FAILED(hr) && errors)
        std::printf("Shader error %S: %s\n", path,
                    (const char*)errors->GetBufferPointer());
    assert(SUCCEEDED(hr));
    return blob;
}
} // namespace

void PbrRenderer::Init(ID3D11Device* device)
{
    ComPtr<ID3DBlob> vsBlob =
        Compile(L"shaders/gbuffer_vs.hlsl", "VSMain", "vs_5_0");
    ComPtr<ID3DBlob> psBlob =
        Compile(L"shaders/gbuffer_ps.hlsl", "PSMain", "ps_5_0");
    device->CreateVertexShader(vsBlob->GetBufferPointer(),
                               vsBlob->GetBufferSize(), nullptr,
                               vs_.GetAddressOf());
    device->CreatePixelShader(psBlob->GetBufferPointer(),
                              psBlob->GetBufferSize(), nullptr,
                              gbufferPs_.GetAddressOf());

    D3D11_INPUT_ELEMENT_DESC layout[] = {
        { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0,
          D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "NORMAL", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 12,
          D3D11_INPUT_PER_VERTEX_DATA, 0 }
    };
    device->CreateInputLayout(layout, 2, vsBlob->GetBufferPointer(),
                              vsBlob->GetBufferSize(),
                              layout_.GetAddressOf());

    std::vector<Vertex> sphere = BuildSphere(24, 32);
    D3D11_BUFFER_DESC vbDesc = {};
    vbDesc.ByteWidth = (UINT)(sphere.size() * sizeof(Vertex));
    vbDesc.Usage = D3D11_USAGE_IMMUTABLE;
    vbDesc.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    D3D11_SUBRESOURCE_DATA vbData = {};
    vbData.pSysMem = sphere.data();
    device->CreateBuffer(&vbDesc, &vbData, vertexBuf_.GetAddressOf());

    std::vector<uint16_t> indices = BuildSphereIndices(24, 32);
    indexCount_ = (UINT)indices.size();
    D3D11_BUFFER_DESC ibDesc = {};
    ibDesc.ByteWidth = (UINT)(indices.size() * sizeof(uint16_t));
    ibDesc.Usage = D3D11_USAGE_IMMUTABLE;
    ibDesc.BindFlags = D3D11_BIND_INDEX_BUFFER;
    D3D11_SUBRESOURCE_DATA ibData = {};
    ibData.pSysMem = indices.data();
    device->CreateBuffer(&ibDesc, &ibData, indexBuf_.GetAddressOf());

    std::vector<Vertex> ground = BuildGround();
    D3D11_BUFFER_DESC gbDesc = {};
    gbDesc.ByteWidth = (UINT)(ground.size() * sizeof(Vertex));
    gbDesc.Usage = D3D11_USAGE_IMMUTABLE;
    gbDesc.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    D3D11_SUBRESOURCE_DATA gbData = {};
    gbData.pSysMem = ground.data();
    device->CreateBuffer(&gbDesc, &gbData, groundVb_.GetAddressOf());

    D3D11_BUFFER_DESC cbDesc = {};
    cbDesc.ByteWidth = sizeof(FrameConstants);
    cbDesc.Usage = D3D11_USAGE_DYNAMIC;
    cbDesc.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cbDesc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    device->CreateBuffer(&cbDesc, nullptr, frameCbuf_.GetAddressOf());
    cbDesc.ByteWidth = sizeof(ObjectConstants);
    device->CreateBuffer(&cbDesc, nullptr, objectCbuf_.GetAddressOf());

    D3D11_SAMPLER_DESC samp = {};
    samp.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    samp.AddressU = samp.AddressV = samp.AddressW =
        D3D11_TEXTURE_ADDRESS_WRAP;
    samp.MaxLOD = D3D11_FLOAT32_MAX;
    device->CreateSamplerState(&samp, sampler_.GetAddressOf());
}

void PbrRenderer::ResizeRenderTargets(ID3D11Device* device, int w, int h)
{
    if (w == renderW_ && h == renderH_) return;
    renderW_ = w;
    renderH_ = h;
    colorSrv_.Reset(); colorRtv_.Reset(); colorTex_.Reset();
    velocitySrv_.Reset(); velocityRtv_.Reset(); velocityTex_.Reset();
    depthSrv_.Reset(); depthRtv_.Reset(); depthTex_.Reset();

    auto makeTarget = [&](DXGI_FORMAT fmt,
                          ComPtr<ID3D11Texture2D>& tex,
                          ComPtr<ID3D11RenderTargetView>& rtv,
                          ComPtr<ID3D11ShaderResourceView>& srv) {
        D3D11_TEXTURE2D_DESC d = {};
        d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1;
        d.Format = fmt;
        d.SampleDesc.Count = 1;
        d.Usage = D3D11_USAGE_DEFAULT;
        d.BindFlags = D3D11_BIND_RENDER_TARGET |
                      D3D11_BIND_SHADER_RESOURCE |
                      D3D11_BIND_UNORDERED_ACCESS;
        device->CreateTexture2D(&d, nullptr, tex.GetAddressOf());
        device->CreateRenderTargetView(tex.Get(), nullptr, rtv.GetAddressOf());
        device->CreateShaderResourceView(tex.Get(), nullptr,
                                         srv.GetAddressOf());
    };
    makeTarget(DXGI_FORMAT_R11G11B10_FLOAT, colorTex_, colorRtv_, colorSrv_);
    makeTarget(DXGI_FORMAT_R16G16_FLOAT, velocityTex_, velocityRtv_,
               velocitySrv_);
    makeTarget(DXGI_FORMAT_R32_FLOAT, depthTex_, depthRtv_, depthSrv_);
}

void PbrRenderer::Render(ID3D11DeviceContext* ctx, Scene& scene,
                         const FrameConstants& fc, int /*frame*/,
                         ID3D11ShaderResourceView* /*depthSrv*/,
                         ID3D11DepthStencilView* dsv)
{
    D3D11_MAPPED_SUBRESOURCE mapped;
    ctx->Map(frameCbuf_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    memcpy(mapped.pData, &fc, sizeof(fc));
    ctx->Unmap(frameCbuf_.Get(), 0);

    ID3D11RenderTargetView* rtvs[3] = {
        colorRtv_.Get(), velocityRtv_.Get(), depthRtv_.Get()
    };
    ctx->OMSetRenderTargets(3, rtvs, dsv);
    D3D11_VIEWPORT vp = { 0, 0, (float)renderW_, (float)renderH_, 0, 1 };
    ctx->RSSetViewports(1, &vp);

    const float clearColor[4] = { 0, 0, 0, 0 };
    ctx->ClearRenderTargetView(colorRtv_.Get(), clearColor);
    const float clearVel[4] = { 0, 0, 0, 0 };
    ctx->ClearRenderTargetView(velocityRtv_.Get(), clearVel);
    const float clearDepth[4] = { 1000.0f, 0, 0, 0 };
    ctx->ClearRenderTargetView(depthRtv_.Get(), clearDepth);

    UINT stride = sizeof(Vertex), offset = 0;
    ctx->IASetVertexBuffers(0, 1, vertexBuf_.GetAddressOf(), &stride, &offset);
    ctx->IASetIndexBuffer(indexBuf_.Get(), DXGI_FORMAT_R16_UINT, 0);
    ctx->IASetPrimitiveTopology(
        D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->IASetInputLayout(layout_.Get());
    ctx->VSSetShader(vs_.Get(), nullptr, 0);
    ctx->PSSetShader(gbufferPs_.Get(), nullptr, 0);
    ID3D11Buffer* cbs[2] = { frameCbuf_.Get(), objectCbuf_.Get() };
    ctx->VSSetConstantBuffers(0, 2, cbs);
    ctx->PSSetConstantBuffers(0, 2, cbs);

    // No hardware depth buffer is bound; painter's-algorithm ordering keeps
    // overlapping spheres composited correctly.
    std::vector<size_t> order(scene.objects.size());
    for (size_t i = 0; i < order.size(); ++i) order[i] = i;
    dx::XMVECTOR cam = dx::XMLoadFloat3(&scene.cameraPos);
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        float da = dx::XMVectorGetX(dx::XMVector3Length(
            dx::XMLoadFloat3(&scene.objects[a].center) - cam));
        float db = dx::XMVectorGetX(dx::XMVector3Length(
            dx::XMLoadFloat3(&scene.objects[b].center) - cam));
        return da > db;
    });

    for (size_t oi = 0; oi < order.size(); ++oi)
    {
        size_t i = order[oi];
        const SceneObject& obj = scene.objects[i];
        dx::XMMATRIX world = dx::XMMatrixScaling(obj.radius, obj.radius,
                                                 obj.radius)
            * dx::XMMatrixTranslation(obj.center.x, obj.center.y,
                                      obj.center.z);
        dx::XMMATRIX prevWorld = dx::XMMatrixScaling(obj.radius,
                                                     obj.radius, obj.radius)
            * dx::XMMatrixTranslation(
                obj.center.x - obj.velocity.x * (1.0f / 60.0f),
                obj.center.y - obj.velocity.y * (1.0f / 60.0f),
                obj.center.z - obj.velocity.z * (1.0f / 60.0f));
        ObjectConstants oc = {};
        dx::XMStoreFloat4x4(&oc.world, dx::XMMatrixTranspose(world));
        dx::XMStoreFloat4x4(&oc.prevWorld,
                            dx::XMMatrixTranspose(prevWorld));
        oc.material.albedoRoughness =
            dx::XMFLOAT4(obj.albedo.x, obj.albedo.y, obj.albedo.z,
                         obj.roughness);
        oc.material.metallicPad = dx::XMFLOAT4(obj.metallic, 0, 0, 0);
        ctx->Map(objectCbuf_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
        memcpy(mapped.pData, &oc, sizeof(oc));
        ctx->Unmap(objectCbuf_.Get(), 0);
        ctx->DrawIndexed(indexCount_, 0, 0);
    }

    // Ground plane with a neutral rough dielectric material.
    ObjectConstants ground = {};
    dx::XMStoreFloat4x4(&ground.world,
                        dx::XMMatrixIdentity());
    dx::XMStoreFloat4x4(&ground.prevWorld, dx::XMMatrixIdentity());
    ground.material.albedoRoughness = dx::XMFLOAT4(0.6f, 0.6f, 0.6f, 0.85f);
    ground.material.metallicPad = dx::XMFLOAT4(0.0f, 0, 0, 0);
    ctx->Map(objectCbuf_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    memcpy(mapped.pData, &ground, sizeof(ground));
    ctx->Unmap(objectCbuf_.Get(), 0);
    UINT gstride = sizeof(Vertex), goffset = 0;
    ctx->IASetVertexBuffers(0, 1, groundVb_.GetAddressOf(), &gstride, &goffset);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->Draw(6, 0);
}
