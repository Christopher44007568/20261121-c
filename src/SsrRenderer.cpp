#include "SsrRenderer.h"
#include <d3dcompiler.h>
#include <cassert>
#include <cstdio>

#pragma comment(lib,"d3d12.lib")
#pragma comment(lib,"dxgi.lib")
#pragma comment(lib,"d3dcompiler.lib")

static UINT Align(UINT v,UINT a){ return (v+a-1u)&~(a-1u); }
static ComPtr<ID3D12Resource> CreateTex2D(ID3D12Device* dev, UINT w,UINT h,
        DXGI_FORMAT fmt, D3D12_RESOURCE_FLAGS flags, const wchar_t* name){
    D3D12_HEAP_PROPERTIES heap{}; heap.Type=D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC d{}; d.Dimension=D3D12_RESOURCE_DIMENSION_TEXTURE2D;
    d.Width=w; d.Height=h; d.DepthOrArraySize=1; d.MipLevels=1;
    d.Format=fmt; d.SampleDesc.Count=1; d.Flags=flags;
    ComPtr<ID3D12Resource> r;
    D3D12_CLEAR_VALUE clear{}; clear.Format=fmt;
    HRESULT hr=dev->CreateCommittedResource(&heap,D3D12_HEAP_FLAG_NONE,&d,
        (flags&D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET)?D3D12_RESOURCE_STATE_RENDER_TARGET:D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE,
        (flags&D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET)?&clear:nullptr,IID_PPV_ARGS(&r));
    (void)hr;
    r->SetName(name);
    return r;
}

bool SsrRenderer::Initialize(HWND hwnd, const SsrSettings& s){
    settings_=s;
    paths_={MakeOrbitPath(),MakeDollyPath()};
    scene_=BuildScene();
    CreateDeviceAndSwapChain(hwnd);
    CreateResources();
    CreatePipelines();
    return true;
}

void SsrRenderer::CreateDeviceAndSwapChain(HWND hwnd){
    UINT factoryFlags=0;
#ifdef _DEBUG
    // Enable the debug layer when the SDK is present; ignore failure on clean runtimes.
    ComPtr<ID3D12Debug> dbg;
    if(SUCCEEDED(D3D12GetDebugInterface(IID_PPV_ARGS(&dbg)))){ dbg->EnableDebugLayer(); factoryFlags|=DXGI_CREATE_FACTORY_DEBUG; }
#endif
    CreateDXGIFactory2(factoryFlags,IID_PPV_ARGS(&factory_));
    ComPtr<IDXGIAdapter1> adapter;
    for(UINT i=0; factory_->EnumAdapters1(i,&adapter)!=DXGI_ERROR_NOT_FOUND; ++i){
        if(SUCCEEDED(D3D12CreateDevice(adapter.Get(),D3D_FEATURE_LEVEL_12_0,IID_PPV_ARGS(&device_)))) break;
    }
    assert(device_);
    D3D12_COMMAND_QUEUE_DESC qd{}; qd.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;
    device_->CreateCommandQueue(&qd,IID_PPV_ARGS(&queue_));
    DXGI_SWAP_CHAIN_DESC1 sc{}; sc.Width=settings_.width; sc.Height=settings_.height;
    sc.Format=DXGI_FORMAT_R8G8B8A8_UNORM; sc.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sc.BufferCount=bufferCount_; sc.SwapEffect=DXGI_SWAP_EFFECT_FLIP_DISCARD; sc.SampleDesc.Count=1;
    ComPtr<IDXGISwapChain1> sc1;
    factory_->CreateSwapChainForHwnd(queue_.Get(),hwnd,&sc,nullptr,nullptr,&sc1);
    sc1.As(&swap_); frameIndex_=swap_->GetCurrentBackBufferIndex();
    device_->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT,IID_PPV_ARGS(&alloc_));
    device_->CreateCommandList(0,D3D12_COMMAND_LIST_TYPE_DIRECT,alloc_.Get(),nullptr,IID_PPV_ARGS(&cl_));
    cl_->Close();
    device_->CreateFence(0,D3D12_FENCE_FLAG_NONE,IID_PPV_ARGS(&fence_));
    fenceEvent_=CreateEventW(nullptr,FALSE,FALSE,nullptr);

    rtvDescSize_=device_->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    srvDescSize_=device_->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
    // RTV heap: 2 swapchain + 6 G-buffer + HiZ levels + SSR/hist targets.
    UINT rtvCount=2+6+(UINT)64;
    D3D12_DESCRIPTOR_HEAP_DESC rh{}; rh.Type=D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rh.NumDescriptors=rtvCount;
    device_->CreateDescriptorHeap(&rh,IID_PPV_ARGS(&rtvHeap_));
    D3D12_CPU_DESCRIPTOR_HANDLE rtv=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    for(UINT i=0;i<bufferCount_;++i){
        swap_->GetBuffer(i,IID_PPV_ARGS(&swapRTV_[i]));
        device_->CreateRenderTargetView(swapRTV_[i].Get(),nullptr,rtv);
        rtv.ptr+=rtvDescSize_;
    }
    D3D12_DESCRIPTOR_HEAP_DESC sh{}; sh.Type=D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
    sh.NumDescriptors=64; sh.Flags=D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    device_->CreateDescriptorHeap(&sh,IID_PPV_ARGS(&cbvSrvHeap_));
}

void SsrRenderer::TogglePath(){ settings_.pathIndex^=1; }
void SsrRenderer::ToggleDebug(){ settings_.showDebug=!settings_.showDebug; }
void SsrRenderer::Shutdown(){ WaitForSingleObject(fenceEvent_,0); if(fenceEvent_) CloseHandle(fenceEvent_); }

static D3D12_RESOURCE_BARRIER Transition(ID3D12Resource* r,
        D3D12_RESOURCE_STATES from, D3D12_RESOURCE_STATES to){
    D3D12_RESOURCE_BARRIER b{}; b.Type=D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    b.Transition.pResource=r; b.Transition.StateBefore=from; b.Transition.StateAfter=to;
    return b;
}

void SsrRenderer::CreateResources(){
    int W=settings_.width, H=settings_.height;
    // Upload scene geometry to a single committed UPLOAD buffer.
    const UINT vbBytes=(UINT)(scene_.verts.size()*sizeof(Vertex));
    const UINT ibBytes=(UINT)(scene_.indices.size()*sizeof(uint32_t));
    const UINT total=Align(vbBytes,16)+Align(ibBytes,16);
    D3D12_HEAP_PROPERTIES up{}; up.Type=D3D12_HEAP_TYPE_UPLOAD;
    D3D12_RESOURCE_DESC bd{}; bd.Dimension=D3D12_RESOURCE_DIMENSION_BUFFER;
    bd.Width=total; bd.Height=1; bd.MipLevels=1; bd.DepthOrArraySize=1;
    bd.Layout=D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    device_->CreateCommittedResource(&up,D3D12_HEAP_FLAG_NONE,&bd,
        D3D12_RESOURCE_STATE_GENERIC_READ,nullptr,IID_PPV_ARGS(&vertexBuf_));
    void* mapped=nullptr; vertexBuf_->Map(0,nullptr,&mapped);
    memcpy(mapped,scene_.verts.data(),vbBytes);
    memcpy((uint8_t*)mapped+Align(vbBytes,16),scene_.indices.data(),ibBytes);
    vertexBuf_->Unmap(0,nullptr);
    vbv_.BufferLocation=vertexBuf_->GetGPUVirtualAddress();
    vbv_.StrideInBytes=sizeof(Vertex); vbv_.SizeInBytes=vbBytes;
    ibv_.BufferLocation=vertexBuf_->GetGPUVirtualAddress()+Align(vbBytes,16);
    ibv_.Format=DXGI_FORMAT_R32_UINT; ibv_.SizeInBytes=ibBytes;
    indexCount_=(UINT)scene_.indices.size();

    // G-buffer MRT: linDepth/viewN/worldN/worldPos/albedo/flags.
    DXGI_FORMAT gfmt[6]={DXGI_FORMAT_R32G32_FLOAT,DXGI_FORMAT_R32G32B32_FLOAT,
        DXGI_FORMAT_R32G32B32_FLOAT,DXGI_FORMAT_R32G32B32_FLOAT,
        DXGI_FORMAT_R8G8B8A8_UNORM,DXGI_FORMAT_R32_UINT};
    gTargets_.resize(6);
    for(int i=0;i<6;++i)
        gTargets_[i]=CreateTex2D(device_.Get(),W,H,gfmt[i],
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET|D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS,
            (L"GBuffer"+std::to_wstring(i)).c_str());

    // Linear-depth Hi-Z pyramid, halving each level to 1x1.
    int lw=W,lh=H;
    do {
        hizLevels_.push_back(CreateTex2D(device_.Get(),lw,lh,DXGI_FORMAT_R32_FLOAT,
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET|D3D12_RESOURCE_FLAG_ALLOW_PIXEL_SHADER_RESOURCE,
            (L"HiZ"+std::to_wstring(hizLevels_.size())).c_str()));
        lw=std::max(1,lw/2); lh=std::max(1,lh/2);
    } while(lw>1 || lh>1);

    ssrColor_=CreateTex2D(device_.Get(),W,H,DXGI_FORMAT_R32G32B32A32_FLOAT,
        D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,L"SSRColor");
    ssrDebug_=CreateTex2D(device_.Get(),W,H,DXGI_FORMAT_R32G32B32A32_FLOAT,
        D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,L"SSRDebug");
    for(UINT i=0;i<2;++i){
        histColor_[i]=CreateTex2D(device_.Get(),W,H,DXGI_FORMAT_R32G32B32A32_FLOAT,
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,(L"HistColor"+std::to_wstring(i)).c_str());
        histMeta_[i]=CreateTex2D(device_.Get(),W,H,DXGI_FORMAT_R32G32B32A32_FLOAT,
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,(L"HistMeta"+std::to_wstring(i)).c_str());
    }
    // Constant buffer (256-byte aligned).
    D3D12_HEAP_PROPERTIES cbHeap{}; cbHeap.Type=D3D12_HEAP_TYPE_UPLOAD;
    D3D12_RESOURCE_DESC cbDesc{}; cbDesc.Dimension=D3D12_RESOURCE_DIMENSION_BUFFER;
    cbDesc.Width=Align(sizeof(CameraCBPOD),256); cbDesc.Height=1;
    cbDesc.DepthOrArraySize=1; cbDesc.MipLevels=1; cbDesc.Layout=D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    device_->CreateCommittedResource(&cbHeap,D3D12_HEAP_FLAG_NONE,&cbDesc,
        D3D12_RESOURCE_STATE_GENERIC_READ,nullptr,IID_PPV_ARGS(&cameraCB_));

    // Fill the shader-visible SRV table in the register order used by
    // SSR.hlsli / Temporal.hlsl / Composite.hlsl.
    auto addSRV=[&](UINT slot, ID3D12Resource* tex, DXGI_FORMAT fmt){
        D3D12_CPU_DESCRIPTOR_HANDLE h=cbvSrvHeap_->GetCPUDescriptorHandleForHeapStart();
        h.ptr+=slot*srvDescSize_;
        D3D12_SHADER_RESOURCE_VIEW_DESC v{};
        v.Format=fmt; v.ViewDimension=D3D12_SRV_DIMENSION_TEXTURE2D;
        v.Shader4ComponentMapping=D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
        v.Texture2D.MipLevels=1;
        device_->CreateShaderResourceView(tex,&v,h);
    };
    addSRV(0,hizLevels_[0].Get(),DXGI_FORMAT_R32_FLOAT);
    addSRV(1,gTargets_[4].Get(),DXGI_FORMAT_R8G8B8A8_UNORM);   // albedo
    addSRV(2,gTargets_[0].Get(),DXGI_FORMAT_R32G32_FLOAT);   // lin depth in .x
    addSRV(3,gTargets_[1].Get(),DXGI_FORMAT_R32G32B32_FLOAT);// view normal
    addSRV(4,gTargets_[2].Get(),DXGI_FORMAT_R32G32B32_FLOAT);// world normal
    addSRV(5,gTargets_[3].Get(),DXGI_FORMAT_R32G32B32_FLOAT);// world pos
    addSRV(6,gTargets_[5].Get(),DXGI_FORMAT_R32_UINT);       // flags
    addSRV(7,histColor_[0].Get(),DXGI_FORMAT_R32G32B32A32_FLOAT);
}

static ComPtr<ID3DBlob> Compile(const wchar_t* path, const char* entry, const char* target){
    ComPtr<ID3DBlob> blob, err;
    UINT flags=D3DCOMPILE_ENABLE_STRICTNESS;
    HRESULT hr=D3DCompileFromFile(path,nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,
        entry,target,flags,0,&blob,&err);
    if(FAILED(hr) && err) OutputDebugStringA((char*)err->GetBufferPointer());
    assert(SUCCEEDED(hr));
    return blob;
}

static ComPtr<ID3D12RootSignature> MakeRootSig(ID3D12Device* dev,
        const std::vector<D3D12_ROOT_PARAMETER>& params,
        const std::vector<D3D12_STATIC_SAMPLER_DESC>& samplers){
    D3D12_ROOT_SIGNATURE_DESC d{}; d.NumParameters=(UINT)params.size();
    d.pParameters=params.data(); d.NumStaticSamplers=(UINT)samplers.size();
    d.pStaticSamplers=samplers.data();
    d.Flags=D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;
    ComPtr<ID3DBlob> sig, err;
    D3D12SerializeRootSignature(&d,D3D_ROOT_SIGNATURE_VERSION_1,&sig,&err);
    ComPtr<ID3D12RootSignature> rs;
    dev->CreateRootSignature(0,sig->GetBufferPointer(),sig->GetBufferSize(),IID_PPV_ARGS(&rs));
    return rs;
}

void SsrRenderer::CreatePipelines(){
    // G-buffer root signature: one CB at b0.
    {
        D3D12_ROOT_PARAMETER rp{}; rp.ParameterType=D3D12_ROOT_PARAMETER_TYPE_CBV;
        rp.Descriptor.ShaderRegister=0; rp.ShaderVisibility=D3D12_SHADER_VISIBILITY_ALL;
        rootSigGBuffer_=MakeRootSig(device_.Get(),{rp},{});
    }
    // Full-screen SSR / temporal / composite signature with descriptor table.
    {
        D3D12_DESCRIPTOR_RANGE range{}; range.RangeType=D3D12_DESCRIPTOR_RANGE_TYPE_SRV;
        range.NumDescriptors=16; range.BaseShaderRegister=0;
        D3D12_ROOT_PARAMETER rp[2]{};
        rp[0].ParameterType=D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
        rp[0].DescriptorTable.NumDescriptorRanges=1; rp[0].DescriptorTable.pDescriptorRanges=&range;
        rp[1].ParameterType=D3D12_ROOT_PARAMETER_TYPE_CBV;
        rp[1].Descriptor.ShaderRegister=1;
        D3D12_STATIC_SAMPLER_DESC smp{}; smp.Filter=D3D12_FILTER_MIN_MAG_MIP_POINT;
        smp.AddressU=smp.AddressV=smp.AddressW=D3D12_TEXTURE_ADDRESS_CLAMP;
        smp.ShaderRegister=0; smp.MaxLOD=D3D12_FLOAT32_MAX;
        rootSigCompute_=MakeRootSig(device_.Get(),{rp[0],rp[1]},{smp});
    }
    auto vs=Compile(L"shaders/GBuffer.hlsl","VSMain","vs_5_1");
    auto ps=Compile(L"shaders/GBuffer.hlsl","PSMain","ps_5_1");
    D3D12_INPUT_ELEMENT_DESC il[]={
        {"POSITION",0,DXGI_FORMAT_R32G32B32_FLOAT,0,0,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0},
        {"NORMAL",0,DXGI_FORMAT_R32G32B32_FLOAT,0,12,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0},
        {"COLOR",0,DXGI_FORMAT_R32G32B32_FLOAT,0,24,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0},
        {"BLENDINDICES",0,DXGI_FORMAT_R32_UINT,0,36,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0},
    };
    D3D12_GRAPHICS_PIPELINE_STATE_DESC pso{};
    pso.pRootSignature=rootSigGBuffer_.Get();
    pso.VS={vs->GetBufferPointer(),vs->GetBufferSize()};
    pso.PS={ps->GetBufferPointer(),ps->GetBufferSize()};
    pso.InputLayout={il,4}; pso.PrimitiveTopologyType=D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    pso.NumRenderTargets=6;
    DXGI_FORMAT gfmt[6]={DXGI_FORMAT_R32G32_FLOAT,DXGI_FORMAT_R32G32B32_FLOAT,
        DXGI_FORMAT_R32G32B32_FLOAT,DXGI_FORMAT_R32G32B32_FLOAT,
        DXGI_FORMAT_R8G8B8A8_UNORM,DXGI_FORMAT_R32_UINT};
    for(int i=0;i<6;++i) pso.RTVFormats[i]=gfmt[i];
    pso.SampleDesc.Count=1; pso.BlendState.RenderTarget[0].RenderTargetWriteMask=D3D12_COLOR_WRITE_ENABLE_ALL;
    pso.RasterizerState.FillMode=D3D12_FILL_MODE_SOLID;
    pso.RasterizerState.CullMode=D3D12_CULL_MODE_BACK;
    pso.DepthStencilState.DepthEnable=FALSE;
    device_->CreateGraphicsPipelineState(&pso,IID_PPV_ARGS(&psoGBuffer_));

    auto makeFullscreen=[&](const wchar_t* file,const char* entry,
            DXGI_FORMAT rt0,DXGI_FORMAT rt1=DXGI_FORMAT_UNKNOWN,
            ComPtr<ID3D12PipelineState>* out=nullptr){
        auto cs=Compile(file,entry,"ps_5_1");
        D3D12_GRAPHICS_PIPELINE_STATE_DESC q{};
        q.pRootSignature=rootSigCompute_.Get();
        q.PS={cs->GetBufferPointer(),cs->GetBufferSize()};
        q.PrimitiveTopologyType=D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
        q.NumRenderTargets=rt1==DXGI_FORMAT_UNKNOWN?1:2;
        q.RTVFormats[0]=rt0; q.RTVFormats[1]=rt1;
        q.SampleDesc.Count=1;
        q.BlendState.RenderTarget[0].RenderTargetWriteMask=D3D12_COLOR_WRITE_ENABLE_ALL;
        q.DepthStencilState.DepthEnable=FALSE;
        ComPtr<ID3D12PipelineState> p;
        device_->CreateGraphicsPipelineState(&q,IID_PPV_ARGS(&p));
        if(out) *out=p; return p;
    };
    psoHiZ_=makeFullscreen(L"shaders/HiZ.hlsl","PSMain",DXGI_FORMAT_R32_FLOAT);
    psoResolve_=makeFullscreen(L"shaders/SSRResolve.hlsl","PSMain",
        DXGI_FORMAT_R32G32B32A32_FLOAT,DXGI_FORMAT_R32G32B32A32_FLOAT);
    psoTemporal_=makeFullscreen(L"shaders/Temporal.hlsl","PSMain",
        DXGI_FORMAT_R32G32B32A32_FLOAT,DXGI_FORMAT_R32G32B32A32_FLOAT);
    psoComposite_=makeFullscreen(L"shaders/Composite.hlsl","PSMain",DXGI_FORMAT_R8G8B8A8_UNORM);
}

using namespace DirectX;

void SsrRenderer::UpdateCamera(int frameIndex){
    const CameraPath& path=paths_[settings_.pathIndex];
    float t=(float)(frameIndex % settings_.frameCount)/(float)settings_.frameCount;
    CameraKey k=path.Sample(t);
    XMVECTOR eye=XMLoadFloat3(&k.eye), at=XMLoadFloat3(&k.target), up=XMVectorSet(0,1,0,0);
    XMMATRIX view=XMMatrixLookAtLH(eye,at,up);          // +Z forward, matches HLSL
    float fov=XM_PI/3.0f, aspect=(float)settings_.width/settings_.height;
    XMMATRIX proj=XMMatrixPerspectiveFovLH(fov,aspect,0.1f,40.0f);
    XMMATRIX vp=XMMatrixMultiply(view,proj);
    static XMMATRIX prevVP=vp;
    CameraCBPOD pod{};
    XMStoreFloat4x4(&pod.view,XMMatrixTranspose(view));
    XMStoreFloat4x4(&pod.proj,XMMatrixTranspose(proj));
    XMStoreFloat4x4(&pod.viewProj,XMMatrixTranspose(vp));
    XMStoreFloat4x4(&pod.invProj,XMMatrixTranspose(XMMatrixInverse(nullptr,proj)));
    XMStoreFloat4x4(&pod.prevViewProj,XMMatrixTranspose(prevVP));
    pod.cameraEye=XMFLOAT4(k.eye.x,k.eye.y,k.eye.z,aspect);
    pod.params=XMFLOAT4(tanf(fov*0.5f),(float)frameIndex,(float)settings_.pathIndex,(float)frameIndex);
    void* mapped=nullptr; cameraCB_->Map(0,nullptr,&mapped);
    memcpy(mapped,&pod,sizeof(pod)); cameraCB_->Unmap(0,nullptr);
    prevVP=vp;
}

// Full-screen triangle generated without a vertex buffer.
static void DrawFullscreen(ID3D12GraphicsCommandList* cl){ cl->DrawInstanced(3,1,0,0); }

void SsrRenderer::GBufferPass(ID3D12GraphicsCommandList* cl){
    // G-buffer RTVs occupy slots 2..7 (after the two swapchain RTVs).
    D3D12_CPU_DESCRIPTOR_HANDLE base=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    D3D12_CPU_DESCRIPTOR_HANDLE rtvs[6];
    for(int i=0;i<6;++i){ rtvs[i]=base; rtvs[i].ptr+=(2+i)*rtvDescSize_;
        device_->CreateRenderTargetView(gTargets_[i].Get(),nullptr,rtvs[i]); }
    cl->OMSetRenderTargets(6,rtvs,FALSE,nullptr);
    cl->SetGraphicsRootSignature(rootSigGBuffer_.Get());
    cl->SetGraphicsRootConstantBufferView(0,cameraCB_->GetGPUVirtualAddress());
    cl->SetPipelineState(psoGBuffer_.Get());
    cl->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    cl->IASetVertexBuffers(0,1,&vbv_); cl->IASetIndexBuffer(&ibv_);
    cl->DrawIndexedInstanced(indexCount_,1,0,0,0);
}

void SsrRenderer::BuildHiZ(ID3D12GraphicsCommandList* cl){
    // Level 0 is a copy of the linear-depth G-buffer target; subsequent levels
    // are rendered as full-screen conservative max reductions.
    cl->SetPipelineState(psoHiZ_.Get());
    D3D12_CPU_DESCRIPTOR_HANDLE base=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    for(size_t lvl=1;lvl<hizLevels_.size();++lvl){
        D3D12_CPU_DESCRIPTOR_HANDLE rtv=base;
        rtv.ptr+=(8+(UINT)lvl)*rtvDescSize_;
        device_->CreateRenderTargetView(hizLevels_[lvl].Get(),nullptr,rtv);
        cl->OMSetRenderTargets(1,&rtv,FALSE,nullptr);
        cl->SetGraphicsRootSignature(rootSigCompute_.Get());
        cl->SetGraphicsRootConstantBufferView(1,cameraCB_->GetGPUVirtualAddress());
        DrawFullscreen(cl);
    }
}

void SsrRenderer::ResolveSSR(ID3D12GraphicsCommandList* cl){
    D3D12_CPU_DESCRIPTOR_HANDLE base=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    D3D12_CPU_DESCRIPTOR_HANDLE rtv[2];
    rtv[0]=base; rtv[0].ptr+=(8+(UINT)hizLevels_.size())*rtvDescSize_;
    rtv[1]=rtv[0]; rtv[1].ptr+=rtvDescSize_;
    device_->CreateRenderTargetView(ssrColor_.Get(),nullptr,rtv[0]);
    device_->CreateRenderTargetView(ssrDebug_.Get(),nullptr,rtv[1]);
    cl->OMSetRenderTargets(2,rtv,FALSE,nullptr);
    cl->SetPipelineState(psoResolve_.Get());
    cl->SetGraphicsRootSignature(rootSigCompute_.Get());
    cl->SetDescriptorHeaps(1,(ID3D12DescriptorHeap* const*)&cbvSrvHeap_);
    cl->SetGraphicsRootDescriptorTable(0,cbvSrvHeap_->GetGPUDescriptorHandleForHeapStart());
    cl->SetGraphicsRootConstantBufferView(1,cameraCB_->GetGPUVirtualAddress());
    DrawFullscreen(cl);
}

void SsrRenderer::TemporalPass(ID3D12GraphicsCommandList* cl){
    UINT slot=frameIndex_&1u;
    D3D12_CPU_DESCRIPTOR_HANDLE base=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    D3D12_CPU_DESCRIPTOR_HANDLE rtv=base;
    rtv.ptr+=(10+(UINT)hizLevels_.size()+slot*2)*rtvDescSize_;
    device_->CreateRenderTargetView(histColor_[slot].Get(),nullptr,rtv);
    cl->OMSetRenderTargets(1,&rtv,FALSE,nullptr);
    cl->SetPipelineState(psoTemporal_.Get());
    cl->SetGraphicsRootSignature(rootSigCompute_.Get());
    cl->SetGraphicsRootConstantBufferView(1,cameraCB_->GetGPUVirtualAddress());
    DrawFullscreen(cl);
}

void SsrRenderer::Composite(ID3D12GraphicsCommandList* cl){
    D3D12_CPU_DESCRIPTOR_HANDLE rtv=rtvHeap_->GetCPUDescriptorHandleForHeapStart();
    rtv.ptr+=frameIndex_*rtvDescSize_;
    cl->OMSetRenderTargets(1,&rtv,FALSE,nullptr);
    cl->SetPipelineState(psoComposite_.Get());
    cl->SetGraphicsRootSignature(rootSigCompute_.Get());
    cl->SetGraphicsRootConstantBufferView(1,cameraCB_->GetGPUVirtualAddress());
    DrawFullscreen(cl);
}

void SsrRenderer::RenderFrame(int frameIndex){
    alloc_->Reset();
    cl_->Reset(alloc_.Get(),nullptr);
    UpdateCamera(frameIndex);
    GBufferPass(cl_);
    BuildHiZ(cl_);
    ResolveSSR(cl_);
    TemporalPass(cl_);
    Composite(cl_);
    cl_->Close();
    ID3D12CommandList* lists[]={cl_.Get()};
    queue_->ExecuteCommandLists(1,lists);
    swap_->Present(1,0);
    queue_->Signal(fence_.Get(),++fenceValue_);
    if(fence_->GetCompletedValue()<fenceValue_){
        fence_->SetEventOnCompletion(fenceValue_,fenceEvent_);
        WaitForSingleObject(fenceEvent_,INFINITE);
    }
    frameIndex_=swap_->GetCurrentBackBufferIndex();
}
