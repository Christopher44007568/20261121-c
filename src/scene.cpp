#include "appstate.h"
#include "geometry.h"
#include <cmath>

static bool CreateMesh(const MeshData& data, Mesh& out) {
    D3D11_BUFFER_DESC bd{};
    D3D11_SUBRESOURCE_DATA init{};
    bd.ByteWidth = (UINT)(data.verts.size() * sizeof(Vertex));
    bd.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    init.pSysMem = data.verts.data();
    if (FAILED(g.dev->CreateBuffer(&bd, &init, &out.vb))) return false;
    bd.ByteWidth = (UINT)(data.indices.size() * sizeof(uint32_t));
    bd.BindFlags = D3D11_BIND_INDEX_BUFFER;
    init.pSysMem = data.indices.data();
    if (FAILED(g.dev->CreateBuffer(&bd, &init, &out.ib))) return false;
    out.indexCount = (UINT)data.indices.size();
    return true;
}

static bool CreateHairTexture() {
    int mipCount = 0;
    const int size = 256;
    std::vector<std::vector<uint8_t>> mips = BuildHairTexture(size, mipCount);

    std::vector<D3D11_SUBRESOURCE_DATA> init(mipCount);
    int w = size;
    for (int i = 0; i < mipCount; ++i) {
        init[i].pSysMem = mips[i].data();
        init[i].SysMemPitch = w * 4;
        w /= 2;
    }
    D3D11_TEXTURE2D_DESC td{};
    td.Width = size; td.Height = size;
    td.MipLevels = mipCount; td.ArraySize = 1;
    td.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_IMMUTABLE;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    ID3D11Texture2D* tex = nullptr;
    if (FAILED(g.dev->CreateTexture2D(&td, init.data(), &tex))) return false;
    HRESULT hr = g.dev->CreateShaderResourceView(tex, nullptr, &g.hairSRV);
    SafeRelease(tex);
    return SUCCEEDED(hr);
}

bool CreateSceneResources() {
    if (!CreateMesh(BuildSphere(1.0f, 40, 28), g.sphere)) return false;
    if (!CreateMesh(BuildGlasses(), g.glasses)) return false;
    if (!CreateMesh(BuildQuad(1.5f, 1.5f), g.quad)) return false;
    if (!CreateHairTexture()) return false;

    // Fan of hair cards across the top of the head. Cards hang down over
    // the forehead so strand tips sweep across the glasses rim and skin.
    const int n = 9;
    for (int i = 0; i < n; ++i) {
        float t = (float)i / (n - 1);          // 0..1 across the fan
        float arc = (t - 0.5f) * 1.9f;         // -0.95..0.95 rad
        HairCard c;
        c.basePos = V3(sinf(arc) * 0.72f,
                       0.88f - 0.10f * fabsf(t - 0.5f),
                       cosf(arc) * 0.62f + 0.18f);
        c.baseRotY = arc * 0.9f;
        c.tiltX = 0.35f + 0.25f * (1.0f - fabsf(t - 0.5f) * 2.0f);
        c.phase = (float)i * 0.83f;
        g.cards.push_back(c);
    }
    return true;
}
