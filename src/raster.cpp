#include "raster.hpp"
#include <algorithm>
#include <limits>

void ColorBuffer::clear(const RGB& bg) {
    for (RGB& px : color) px = bg;
    std::fill(depth.begin(), depth.end(), 1.0f);
}

// Sutherland-Hodgman against the six clip planes (w-relative).
static float clipSide(const Vec4& c, int plane) {
    const float& x = c.x; const float& y = c.y;
    const float& z = c.z; const float& w = c.w;
    switch (plane) {
        case 0: return w + x;   // x >= -w
        case 1: return w - x;   // x <=  w
        case 2: return w + y;
        case 3: return w - y;
        case 4: return z;       // z >= 0
        default: return w - z;  // z <= w
    }
}

std::vector<ClipVertex> clipToFrustum(const ClipVertex& a,
                                      const ClipVertex& b,
                                      const ClipVertex& c) {
    std::vector<ClipVertex> in{a, b, c}, out;
    for (int plane = 0; plane < 6; ++plane) {
        out.clear();
        int n = static_cast<int>(in.size());
        for (int i = 0; i < n; ++i) {
            const ClipVertex& cur = in[i];
            const ClipVertex& prev = in[(i + n - 1) % n];
            float dc = clipSide(cur.clip, plane);
            float dp = clipSide(prev.clip, plane);
            if (dc >= 0.0f) {
                if (dp < 0.0f) {
                    float t = dp / (dp - dc);
                    ClipVertex r;
                    r.clip = Vec4{
                        prev.clip.x + (cur.clip.x - prev.clip.x) * t,
                        prev.clip.y + (cur.clip.y - prev.clip.y) * t,
                        prev.clip.z + (cur.clip.z - prev.clip.z) * t,
                        prev.clip.w + (cur.clip.w - prev.clip.w) * t};
                    r.world = prev.world * (1 - t) + cur.world * t;
                    out.push_back(r);
                }
                out.push_back(cur);
            } else if (dp >= 0.0f) {
                float t = dp / (dp - dc);
                ClipVertex r;
                r.clip = Vec4{
                    prev.clip.x + (cur.clip.x - prev.clip.x) * t,
                    prev.clip.y + (cur.clip.y - prev.clip.y) * t,
                    prev.clip.z + (cur.clip.z - prev.clip.z) * t,
                    prev.clip.w + (cur.clip.w - prev.clip.w) * t};
                r.world = prev.world * (1 - t) + cur.world * t;
                out.push_back(r);
            }
        }
        in.swap(out);
        if (in.empty()) return in;
    }
    return in;
}

void renderShadowDepth(ColorBuffer& map, const Scene& scene,
                       const Mat4& lightVP, const ShadowRenderOpts& opts) {
    map.clear(RGB{255, 255, 255});
    const int W = map.width, H = map.height;
    for (const Triangle& tri : scene.mesh.tris) {
        Vec3 wa = scene.mesh.positions[tri.a];
        Vec3 wb = scene.mesh.positions[tri.b];
        Vec3 wc = scene.mesh.positions[tri.c];
        if (opts.texelWorld > 0.0f) {
            Vec3 n = normalize(cross(wb - wa, wc - wa));
            // Normal-offset bias: lift the caster along its own normal by a
            // texel-scaled amount to defeat grazing-angle self shadowing.
            float push = opts.texelWorld * 1.5f;
            wa += n * push; wb += n * push; wc += n * push;
        }
        ClipVertex v0{mul(lightVP, {wa.x, wa.y, wa.z, 1.0f}), wa};
        ClipVertex v1{mul(lightVP, {wb.x, wb.y, wb.z, 1.0f}), wb};
        ClipVertex v2{mul(lightVP, {wc.x, wc.y, wc.z, 1.0f}), wc};
        auto poly = clipToFrustum(v0, v1, v2);
        for (size_t k = 1; k + 1 < poly.size(); ++k) {
            ClipVertex p0 = poly[0], p1 = poly[k], p2 = poly[k + 1];
            Vec3 s0(p0.clip.x / p0.clip.w, p0.clip.y / p0.clip.w,
                    p0.clip.z / p0.clip.w);
            Vec3 s1(p1.clip.x / p1.clip.w, p1.clip.y / p1.clip.w,
                    p1.clip.z / p1.clip.w);
            Vec3 s2(p2.clip.x / p2.clip.w, p2.clip.y / p2.clip.w,
                    p2.clip.z / p2.clip.w);
            auto toPx = [&](const Vec3& ndc) {
                return Vec3((ndc.x * 0.5f + 0.5f) * W,
                            (ndc.y * 0.5f + 0.5f) * H, ndc.z);
            };
            Vec3 q0 = toPx(s0), q1 = toPx(s1), q2 = toPx(s2);
            float area = (q1.x - q0.x) * (q2.y - q0.y)
                       - (q2.x - q0.x) * (q1.y - q0.y);
            if (std::abs(area) < 1e-8f) continue;
            int minX = std::max(0, (int)std::floor(std::min({q0.x,q1.x,q2.x})));
            int maxX = std::min(W - 1, (int)std::ceil(std::max({q0.x,q1.x,q2.x})));
            int minY = std::max(0, (int)std::floor(std::min({q0.y,q1.y,q2.y})));
            int maxY = std::min(H - 1, (int)std::ceil(std::max({q0.y,q1.y,q2.y})));
            for (int y = minY; y <= maxY; ++y) {
                for (int x = minX; x <= maxX; ++x) {
                    float px = x + 0.5f, py = y + 0.5f;
                    float w0 = ((q1.x - px) * (q2.y - py) - (q2.x - px) * (q1.y - py)) / area;
                    float w1 = ((q2.x - px) * (q0.y - py) - (q0.x - px) * (q2.y - py)) / area;
                    float w2 = 1.0f - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    float z = w0 * q0.z + w1 * q1.z + w2 * q2.z;
                    int idx = y * W + x;
                    if (z < map.depth[idx]) map.depth[idx] = z;
                }
            }
        }
    }
}

float shadowSample(const ColorBuffer& map, int x, int y) {
    x = std::clamp(x, 0, map.width - 1);
    y = std::clamp(y, 0, map.height - 1);
    return map.depth[y * map.width + x];
}
