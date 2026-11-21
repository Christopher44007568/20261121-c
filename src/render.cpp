#include "appstate.h"
#include <cmath>

struct CBData {
    Mat4 world;
    Mat4 viewProj;
    Vec4 lightDir;  // w = exposure
    Vec4 camPos;    // w = time
    Vec4 tint;      // a = aux (msaa count for coverage debug)
};

void UpdateAnimation(float dt) {
    if (!g.paused) g.animTime += dt;
}

static void SetCB(const Mat4& world, const Mat4& viewProj,
                  const Vec4& light, const Vec4& cam,
                  const Vec4& tint) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (FAILED(g.ctx->Map(g.cb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return;
    CBData* cb = (CBData*)m.pData;
    cb->world = Mat4Transpose(world);
    cb->viewProj = Mat4Transpose(viewProj);
    cb->lightDir = light;
    cb->camPos = cam;
    cb->tint = tint;
    g.ctx->Unmap(g.cb, 0);
    g.ctx->VSSetConstantBuffers(0, 1, &g.cb);
    g.ctx->PSSetConstantBuffers(0, 1, &g.cb);
}

static void DrawMesh(const Mesh& mesh) {
    UINT stride = 32, offset = 0;
    g.ctx->IASetVertexBuffers(0, 1, &mesh.vb, &stride, &offset);
    g.ctx->IASetIndexBuffer(mesh.ib, DXGI_FORMAT_R32_UINT, 0);
    g.ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g.ctx->DrawIndexed(mesh.indexCount, 0, 0);
}

static Mat4 HairWorld(const HairCard& c, float t, float sweep) {
    float sway = 0.10f * sinf(t * 1.4f + c.phase);
    float bob = 0.03f * sinf(t * 0.9f + c.phase * 1.7f);
    Mat4 m = Mat4RotationZ(sway);
    m = Mat4Multiply(m, Mat4RotationX(c.tiltX));
    m = Mat4Multiply(m, Mat4RotationY(c.baseRotY));
    m = Mat4Multiply(m, Mat4Translation(
        c.basePos.x + sweep, c.basePos.y + bob, c.basePos.z));
    return m;
}

void RenderFrame() {
    const float t = g.animTime;
    // scrolling camera: slow orbit + gentle vertical bob
    float yaw = t * g.camSpeed;
    Vec4 cam = V4(3.6f * sinf(yaw), 0.55f + 0.25f * sinf(t * 0.23f),
                  3.6f * cosf(yaw), t);
    // brightness variation while the camera scrolls
    float exposure = 1.0f + 0.18f * sinf(t * 0.9f);
    Vec3 ld = Vec3Normalize(V3(sinf(t * 0.3f) * 0.6f, 1.0f, 0.8f));
    Vec4 light = V4(ld.x, ld.y, ld.z, 0);
    light.w = exposure;
    float sweep = 0.55f * sinf(t * 0.35f); // hair sheets sweep across glasses

    const float clearCol[4] = { 0.16f, 0.18f, 0.24f, 1.0f };
    g.ctx->ClearRenderTargetView(g.sceneRTV, clearCol);
    g.ctx->ClearDepthStencilView(g.dsv, D3D11_CLEAR_DEPTH, 1.0f, 0);

    g.ctx->IASetInputLayout(g.layout);
    g.ctx->VSSetShader(g.vs, nullptr, 0);
    g.ctx->PSSetShaderResources(0, 1, &g.hairSRV);
    g.ctx->PSSetSamplers(0, 1, &g.samp);
    g.ctx->OMSetRenderTargets(1, &g.sceneRTV, g.dsv);

    const UINT halfW = g.width / 2;
    const float aspect = (float)halfW / (float)g.height;
    Mat4 proj = Mat4PerspectiveFovLH(40.0f * 0.017453292f, aspect, 0.1f, 50.0f);
    Mat4 view = Mat4LookAtLH(V3(cam.x, cam.y, cam.z), V3(0, 0.05f, 0), V3(0, 1, 0));
    Mat4 viewProj = Mat4Multiply(view, proj);

    for (int half = 0; half < 2; ++half) {
        D3D11_VIEWPORT vp{ (float)(half * halfW), 0.0f, (float)halfW,
                           (float)g.height, 0.0f, 1.0f };
        g.ctx->RSSetViewports(1, &vp);
        D3D11_RECT sc{ (LONG)(half * halfW), 0, (LONG)(half * halfW + halfW),
                       (LONG)g.height };
        g.ctx->RSSetScissorRects(1, &sc);

        // opaque scene: skin head + glasses
        g.ctx->RSSetState(g.rsBack);
        g.ctx->OMSetDepthStencilState(g.dsOpaque, 0);
        g.ctx->OMSetBlendState(g.bsOpaque, nullptr, 0xffffffff);
        g.ctx->PSSetShader(g.psOpaque, nullptr, 0);
        SetCB(Mat4Identity(), viewProj, light, cam,
              V4(0.86f, 0.62f, 0.50f, 1.0f));
        DrawMesh(g.sphere);
        SetCB(Mat4Identity(), viewProj, light, cam,
              V4(0.12f, 0.12f, 0.16f, 1.0f));
        DrawMesh(g.glasses);

        // hair pass: left = A2C, right = alpha-test clip
        g.ctx->RSSetState(g.rsNone);
        g.ctx->OMSetDepthStencilState(
            g.hairDepthWrite ? g.dsHairWrite : g.dsHairNoWrite, 0);
        if (half == 0) {
            g.ctx->OMSetBlendState(g.bsA2C, nullptr, 0xffffffff);
            g.ctx->PSSetShader(g.coverageDebug ? g.psHairCoverage : g.psHairA2C,
                               nullptr, 0);
        } else {
            g.ctx->OMSetBlendState(g.bsOpaque, nullptr, 0xffffffff);
            g.ctx->PSSetShader(g.psHairClip, nullptr, 0);
        }
        Vec4 tint = V4(1, 1, 1, (float)g.msaaCount);
        for (const HairCard& c : g.cards) {
            SetCB(HairWorld(c, t, sweep), viewProj, light, cam, tint);
            DrawMesh(g.quad);
        }
    }

    // resolve / copy scene into the backbuffer
    ID3D11Texture2D* back = nullptr;
    g.swap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&back);
    if (g.msaaCount > 1)
        g.ctx->ResolveSubresource(back, 0, g.sceneTex, 0, DXGI_FORMAT_B8G8R8A8_UNORM);
    else
        g.ctx->CopyResource(back, g.sceneTex);
    SafeRelease(back);

    DrawHUD();
    g.swap->Present(1, 0);
}

static void DrawText(ID2D1RenderTarget* rt, IDWriteTextFormat* fmt,
                     ID2D1SolidColorBrush* brush, const wchar_t* text,
                     float x, float y, float w, float h) {
    rt->DrawTextW(text, (UINT32)wcslen(text), fmt,
                 D2D1::RectF(x, y, x + w, y + h), brush);
}

void DrawHUD() {
    if (!g.d2dRT || !g.fmtBody) return;
    ID2D1RenderTarget* rt = g.d2dRT;
    const float W = (float)g.width, H = (float)g.height;

    rt->BeginDraw();
    ID2D1SolidColorBrush* white = nullptr; ID2D1SolidColorBrush* bg = nullptr;
    ID2D1SolidColorBrush* green = nullptr; ID2D1SolidColorBrush* yellow = nullptr;
    rt->CreateSolidColorBrush(D2D1::ColorF(1, 1, 1, 1), &white);
    rt->CreateSolidColorBrush(D2D1::ColorF(0, 0, 0, 0.55f), &bg);
    rt->CreateSolidColorBrush(D2D1::ColorF(0.4f, 1.0f, 0.5f, 1), &green);
    rt->CreateSolidColorBrush(D2D1::ColorF(1.0f, 0.9f, 0.3f, 1), &yellow);

    const float halfW = W * 0.5f;
    // center divider
    rt->DrawLine(D2D1::Point2F(halfW, 0), D2D1::Point2F(halfW, H), white, 2.0f);

    // half titles
    rt->FillRectangle(D2D1::RectF(8, 6, halfW - 8, 30), bg);
    rt->FillRectangle(D2D1::RectF(halfW + 8, 6, W - 8, 30), bg);
    DrawText(rt, g.fmtTitle, green,
        g.coverageDebug ? L"A2C — 覆盖掩码调试图 (绿=覆盖样本数)"
                        : L"左: Alpha-to-Coverage (A2C)",
        14, 7, halfW - 20, 24);
    DrawText(rt, g.fmtTitle, yellow, L"右: Alpha-Test  clip(alpha - 0.5)",
        halfW + 14, 7, halfW - 20, 24);

    // rotating explanation tips
    static const wchar_t* tips[] = {
        L"A2C: 像素 alpha 被硬件转成每样本覆盖掩码, 4x MSAA 解析后得到平滑的发丝边缘",
        L"Alpha-Test: clip() 以像素为单位取舍, 即使 4x MSAA 也无法柔化纹理边缘 -> 锯齿",
        L"相机滚动时亚像素覆盖不断变化, 边缘像素亮度闪烁 -> 时间性锯齿(对比左右两侧)",
        L"A2C + 深度写入: 半透明发片仍写入深度, 后方发丝被错误压盖 -> 按 D 关闭深度写入对比",
        L"无 MSAA 时 A2C 退化为普通 alpha 混合, 未排序的发片互相错误遮挡 -> 按 M 对比",
        L"发片掠过眼镜边缘: 注意左侧边缘平滑压过镜框, 右侧则啃出镜框硬边",
    };
    const int tipCount = sizeof(tips) / sizeof(tips[0]);
    const wchar_t* tip = tips[((int)(g.animTime / 6.0f)) % tipCount];
    rt->FillRectangle(D2D1::RectF(8, H - 66, W - 8, H - 40), bg);
    DrawText(rt, g.fmtBody, white, tip, 14, H - 64, W - 28, 24);

    // status / key help
    wchar_t status[256];
    swprintf(status, 256,
        L"[M] MSAA: %s   [D] 发丝深度写入: %s   [C] 覆盖掩码调试: %s   [↑/↓] 相机速度: %.2f   [Space] %s",
        g.msaaCount > 1 ? L"4x" : L"关",
        g.hairDepthWrite ? L"开" : L"关",
        g.coverageDebug ? L"开" : L"关",
        g.camSpeed, g.paused ? L"继续" : L"暂停");
    rt->FillRectangle(D2D1::RectF(8, H - 34, W - 8, H - 8), bg);
    DrawText(rt, g.fmtBody, white, status, 14, H - 32, W - 28, 24);

    rt->EndDraw();
    SafeRelease(white); SafeRelease(bg); SafeRelease(green); SafeRelease(yellow);
}
