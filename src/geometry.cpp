#include "geometry.h"
#include <cmath>
#include <cstdlib>

static const float kPi = 3.14159265358979f;

MeshData BuildSphere(float radius, int slices, int stacks) {
    MeshData m;
    for (int y = 0; y <= stacks; ++y) {
        float v = (float)y / stacks;
        float phi = v * kPi;
        for (int x = 0; x <= slices; ++x) {
            float u = (float)x / slices;
            float theta = u * 2.0f * kPi;
            float sx = sinf(phi) * cosf(theta);
            float sy = cosf(phi);
            float sz = sinf(phi) * sinf(theta);
            Vertex vtx{ radius * sx, radius * sy, radius * sz, sx, sy, sz, u, v };
            m.verts.push_back(vtx);
        }
    }
    for (int y = 0; y < stacks; ++y)
        for (int x = 0; x < slices; ++x) {
            uint32_t a = y * (slices + 1) + x, b = a + slices + 1;
            m.indices.insert(m.indices.end(), { a, b, a + 1, a + 1, b, b + 1 });
        }
    return m;
}

static void AppendBox(MeshData& m, float cx, float cy, float cz,
                      float sx, float sy, float sz) {
    const float hx = sx * 0.5f, hy = sy * 0.5f, hz = sz * 0.5f;
    // 8 corners, 6 quad faces (CCW), per-face normals
    const float c[8][3] = {
        {-hx,-hy,-hz},{ hx,-hy,-hz},{ hx, hy,-hz},{-hx, hy,-hz},
        {-hx,-hy, hz},{ hx,-hy, hz},{ hx, hy, hz},{-hx, hy, hz},
    };
    const int quads[6][4] = {
        {1, 5, 6, 2}, // +x
        {4, 0, 3, 7}, // -x
        {3, 2, 6, 7}, // +y
        {4, 5, 1, 0}, // -y
        {5, 4, 7, 6}, // +z
        {0, 1, 2, 3}, // -z
    };
    const float nrm[6][3] = {
        {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1},
    };
    for (int f = 0; f < 6; ++f) {
        uint32_t base = (uint32_t)m.verts.size();
        for (int i = 0; i < 4; ++i) {
            int ci = quads[f][i];
            Vertex v{ cx + c[ci][0], cy + c[ci][1], cz + c[ci][2],
                      nrm[f][0], nrm[f][1], nrm[f][2],
                      (float)(i & 1), (float)(i >> 1) };
            m.verts.push_back(v);
        }
        m.indices.insert(m.indices.end(),
            { base, base + 1, base + 2, base, base + 2, base + 3 });
    }
}

// Glasses: two box-frame rims + bridge + temples + opaque lenses,
// merged into a single mesh in front of the face (+z).
MeshData BuildGlasses() {
    MeshData m;
    const float rimW = 0.46f, rimH = 0.34f, bar = 0.045f, depth = 0.06f;
    const float z = 0.98f, eyeX = 0.46f, eyeY = 0.12f;
    for (int s = -1; s <= 1; s += 2) {
        float cx = s * eyeX;
        AppendBox(m, cx, eyeY + rimH, z, rimW * 2 + bar, bar, depth); // top
        AppendBox(m, cx, eyeY - rimH, z, rimW * 2 + bar, bar, depth); // bottom
        AppendBox(m, cx - rimW, eyeY, z, bar, rimH * 2 + bar, depth); // left
        AppendBox(m, cx + rimW, eyeY, z, bar, rimH * 2 + bar, depth); // right
        AppendBox(m, cx, eyeY, z - 0.03f, rimW * 2 - bar, rimH * 2 - bar, 0.02f); // lens
        AppendBox(m, s * (eyeX + rimW), eyeY + 0.05f, z - 0.55f, bar, bar, 1.1f); // temple
    }
    AppendBox(m, 0.0f, eyeY + 0.08f, z, 2.0f * (eyeX - rimW) + bar, bar, depth); // bridge
    return m;
}

MeshData BuildQuad(float w, float h) {
    MeshData m;
    const float hw = w * 0.5f;
    m.verts = {
        { -hw, 0, 0,  0, 0, 1, 0, 0 },
        {  hw, 0, 0,  0, 0, 1, 1, 0 },
        {  hw, -h, 0, 0, 0, 1, 1, 1 },
        { -hw, -h, 0, 0, 0, 1, 0, 1 },
    };
    m.indices = { 0, 1, 2, 0, 2, 3 };
    return m;
}

// Deterministic tiny PRNG so the texture is stable run-to-run.
static uint32_t s_rng = 12345u;
static float Frand() {
    s_rng = s_rng * 1664525u + 1013904223u;
    return (float)(s_rng >> 8) / 16777216.0f;
}

std::vector<std::vector<uint8_t>> BuildHairTexture(int size, int& outMipCount) {
    struct Strand { float x, w, len, tone; };
    std::vector<Strand> strands;
    const int count = 46;
    for (int i = 0; i < count; ++i) {
        Strand s;
        s.x = Frand() * size;
        s.w = 1.2f + Frand() * 2.6f;              // strand width in texels
        s.len = 0.55f + Frand() * 0.45f;          // relative length
        s.tone = 0.55f + Frand() * 0.45f;
        strands.push_back(s);
    }

    std::vector<std::vector<uint8_t>> mips;
    std::vector<uint8_t> level(size * size * 4);
    for (int y = 0; y < size; ++y) {
        float v = (float)y / (size - 1);
        for (int x = 0; x < size; ++x) {
            float alpha = 0.0f, tone = 0.0f;
            for (const Strand& s : strands) {
                // strand end fades out near its length -> wispy tips
                float endFade = 1.0f;
                if (v > s.len) {
                    endFade = 1.0f - (v - s.len) / (1.0f - s.len + 1e-5f);
                    endFade = endFade < 0.0f ? 0.0f : endFade;
                }
                float dx = fabsf((float)x - s.x);
                dx = fminf(dx, (float)size - dx); // wrap horizontally
                float cov = 1.0f - dx / s.w;
                if (cov > 0.0f) {
                    float a = cov * endFade;
                    if (a > alpha) { alpha = a; tone = s.tone; }
                }
            }
            // slight vertical brightness variation for shimmer while scrolling
            tone *= 0.85f + 0.15f * sinf(v * 40.0f);
            uint8_t* p = &level[(y * size + x) * 4];
            p[0] = (uint8_t)(96.0f * tone + 24.0f);  // R: dark brown
            p[1] = (uint8_t)(58.0f * tone + 14.0f);  // G
            p[2] = (uint8_t)(34.0f * tone + 8.0f);   // B
            p[3] = (uint8_t)(alpha * 255.0f + 0.5f); // A
        }
    }
    mips.push_back(level);

    // box-filter mip chain (straight average of RGBA)
    int cur = size;
    while (cur > 1) {
        int next = cur / 2;
        const std::vector<uint8_t>& src = mips.back();
        std::vector<uint8_t> dst(next * next * 4);
        for (int y = 0; y < next; ++y)
            for (int x = 0; x < next; ++x)
                for (int c = 0; c < 4; ++c) {
                    int sum = 0;
                    for (int dy = 0; dy < 2; ++dy)
                        for (int dx = 0; dx < 2; ++dx)
                            sum += src[((2 * y + dy) * cur + 2 * x + dx) * 4 + c];
                    dst[(y * next + x) * 4 + c] = (uint8_t)(sum / 4);
                }
        mips.push_back(dst);
        cur = next;
    }
    outMipCount = (int)mips.size();
    return mips;
}
