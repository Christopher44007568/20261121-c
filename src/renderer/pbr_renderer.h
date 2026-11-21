#pragma once
#include "dx11_context.h"
#include "scene.h"

// G-buffer layout rendered at the dynamic (internal) resolution:
//   colorHdr  RGBA16F  (RGB linear HDR, A unused)
//   velocity  RG16F    (XY motion in internal-resolution pixels)
//   depth     R32      (linear view depth in R, via the depth texture SRV)
class PbrRenderer
{
public:
    void Init(ID3D11Device* device);
    // (Re)allocate internal-resolution targets.
    void ResizeRenderTargets(ID3D11Device* device, int w, int h);
    void Render(ID3D11DeviceContext* ctx, Scene& scene,
                const FrameConstants& fc, int frame,
                ID3D11ShaderResourceView* depthSrv,
                ID3D11DepthStencilView* dsv);

    ID3D11ShaderResourceView* ColorSrv() const { return colorSrv_.Get(); }
    ID3D11ShaderResourceView* VelocitySrv() const { return velocitySrv_.Get(); }
    ID3D11ShaderResourceView* LinearDepthSrv() const { return depthSrv_.Get(); }
    ID3D11Texture2D* LinearDepthTex() const { return depthTex_.Get(); }
    ID3D11RenderTargetView* ColorRtv() const { return colorRtv_.Get(); }
    ID3D11RenderTargetView* VelocityRtv() const { return velocityRtv_.Get(); }

private:
    ComPtr<ID3D11VertexShader> vs_;
    ComPtr<ID3D11PixelShader> gbufferPs_;
    ComPtr<ID3D11PixelShader> lightingPs_;
    ComPtr<ID3D11InputLayout> layout_;
    ComPtr<ID3D11Buffer> vertexBuf_;
    ComPtr<ID3D11Buffer> indexBuf_;
    ComPtr<ID3D11Buffer> groundVb_;
    UINT indexCount_ = 0;
    ComPtr<ID3D11Buffer> frameCbuf_;
    ComPtr<ID3D11Buffer> objectCbuf_;
    ComPtr<ID3D11SamplerState> sampler_;

    ComPtr<ID3D11Texture2D> colorTex_;
    ComPtr<ID3D11Texture2D> velocityTex_;
    ComPtr<ID3D11Texture2D> depthTex_;
    ComPtr<ID3D11RenderTargetView> colorRtv_;
    ComPtr<ID3D11RenderTargetView> velocityRtv_;
    ComPtr<ID3D11RenderTargetView> depthRtv_;
    ComPtr<ID3D11ShaderResourceView> colorSrv_;
    ComPtr<ID3D11ShaderResourceView> velocitySrv_;
    ComPtr<ID3D11ShaderResourceView> depthSrv_;
    int renderW_ = 0, renderH_ = 0;
};
