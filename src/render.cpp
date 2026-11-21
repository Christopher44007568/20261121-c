#include "render.hpp"
#include <algorithm>

static Vec3 skyColor(float ndcY) {
    float t = std::clamp(ndcY * 0.5f + 0.5f, 0.0f, 1.0f);
    Vec3 horizon(0.55f, 0.62f, 0.72f);
    Vec3 zenith(0.22f, 0.32f, 0.48f);
    return horizon * (1.0f - t) + zenith * t;
}

static int selectCascade(float viewDepth, const std::vector<Cascade>& c) {
    for (size_t i = 0; i < c.size(); ++i)
        if (viewDepth <= c[i].farDepth || i + 1 == c.size())
            return static_cast<int>(i);
    return static_cast<int>(c.size()) - 1;
}

static float shadowFactor(const Vec3& world, const Cascade& c,
                          const ColorBuffer& map, float bias) {
    Vec3 ndc = projectLight(c, world);
    if (std::abs(ndc.x) > 1.0f || std::abs(ndc.y) > 1.0f) return 1.0f;
    int px = static_cast<int>((ndc.x * 0.5f + 0.5f) * map.width);
    int py = static_cast<int>((ndc.y * 0.5f + 0.5f) * map.height);
    float stored = shadowSample(map, px, py);
    // Forward depth: occluded when stored + bias < receiver depth.
    return (stored + bias < ndc.z) ? 0.0f : 1.0f;
}

void renderView(ColorBuffer& fb, const Scene& scene,
                const CameraState& cam, const CameraParams& camParams,
                const std::vector<Cascade>& cascades,
                const std::vector<ColorBuffer>& shadowMaps,
                const RenderOptions& opts) {
    fb.clear(RGB{});
    const int W = fb.width, H = fb.height;
    Mat4 view = cam.viewMatrix();
    Mat4 proj = perspective(camParams.fovYDeg * 3.14159265f / 180.0f,
                            camParams.aspect, camParams.nearZ, camParams.farZ);
    Mat4 vp = multiply(proj, view);
    Vec3 sun = normalize(scene.sunDir);

    // Paint sky first; triangles overdraw it where geometry exists.
    for (int y = 0; y < H; ++y) {
        float ndcY = 1.0f - 2.0f * (y + 0.5f) / H;
        RGB c;
        Vec3 col = skyColor(ndcY);
        c.r = (uint8_t)std::clamp(col.x * 255, 0.0f, 255.0f);
        c.g = (uint8_t)std::clamp(col.y * 255, 0.0f, 255.0f);
        c.b = (uint8_t)std::clamp(col.z * 255, 0.0f, 255.0f);
        for (int x = 0; x < W; ++x) fb.color[y * W + x] = c;
    }

    const Vec3 cascadeTint[4] = {
        {1.00f, 1.00f, 1.00f}, {0.92f, 1.00f, 0.92f},
        {0.92f, 0.95f, 1.00f}, {1.00f, 0.95f, 0.90f}};

    for (const Triangle& tri : scene.mesh.tris) {
        Vec3 p0 = scene.mesh.positions[tri.a];
        Vec3 p1 = scene.mesh.positions[tri.b];
        Vec3 p2 = scene.mesh.positions[tri.c];
        Vec4 cl0 = mul(vp, {p0.x, p0.y, p0.z, 1});
        Vec4 cl1 = mul(vp, {p1.x, p1.y, p1.z, 1});
        Vec4 cl2 = mul(vp, {p2.x, p2.y, p2.z, 1});
        Vec3 normal = normalize(cross(p1 - p0, p2 - p0));
        Material mat = scene.materials[tri.material];

        auto poly = clipToFrustum({cl0, p0}, {cl1, p1}, {cl2, p2});
        for (size_t k = 1; k + 1 < poly.size(); ++k) {
            const ClipVertex& cv0 = poly[0];
            const ClipVertex& cv1 = poly[k];
            const ClipVertex& cv2 = poly[k + 1];
            auto toNdc = [](const ClipVertex& v) {
                return Vec3(v.clip.x / v.clip.w, v.clip.y / v.clip.w,
                            v.clip.z / v.clip.w);
            };
            Vec3 n0 = toNdc(cv0), n1 = toNdc(cv1), n2 = toNdc(cv2);
            auto sx = [&](const Vec3& n) { return (n.x * .5f + .5f) * W; };
            auto sy = [&](const Vec3& n) { return (1 - (n.y * .5f + .5f)) * H; };
            float iw0 = 1.0f / cv0.clip.w, iw1 = 1.0f / cv1.clip.w,
                  iw2 = 1.0f / cv2.clip.w;
            Vec3 q0(sx(n0), sy(n0), n0.z), q1(sx(n1), sy(n1), n1.z),
                  q2(sx(n2), sy(n2), n2.z);
            float area = (q1.x - q0.x) * (q2.y - q0.y)
                       - (q2.x - q0.x) * (q1.y - q0.y);
            if (std::abs(area) < 1e-8f) continue;
            int minX = std::max(0, (int)std::floor(std::min({q0.x,q1.x,q2.x})));
            int maxX = std::min(W-1, (int)std::ceil(std::max({q0.x,q1.x,q2.x})));
            int minY = std::max(0, (int)std::floor(std::min({q0.y,q1.y,q2.y})));
            int maxY = std::min(H-1, (int)std::ceil(std::max({q0.y,q1.y,q2.y})));

            for (int y = minY; y <= maxY; ++y) {
                for (int x = minX; x <= maxX; ++x) {
                    float px = x + 0.5f, py = y + 0.5f;
                    float b0 = ((q1.x-px)*(q2.y-py) - (q2.x-px)*(q1.y-py)) / area;
                    float b1 = ((q2.x-px)*(q0.y-py) - (q0.x-px)*(q2.y-py)) / area;
                    float b2 = 1 - b0 - b1;
                    if (b0 < 0 || b1 < 0 || b2 < 0) continue;
                    float persp = b0*iw0 + b1*iw1 + b2*iw2;
                    float a0 = b0*iw0/persp, a1 = b1*iw1/persp, a2 = b2*iw2/persp;
                    float z = a0*q0.z + a1*q1.z + a2*q2.z;
                    int idx = y * W + x;
                    if (z < fb.depth[idx] - 1e-7f && z >= 0 && z <= 1) {
                        Vec3 world = cv0.world*a0 + cv1.world*a1 + cv2.world*a2;
                        Vec4 view4 = mul(view, {world.x, world.y, world.z, 1});
                        float viewDepth = view4.z;
                        int ci = selectCascade(viewDepth, cascades);
                        float lit = shadowFactor(world, cascades[ci],
                                                 shadowMaps[ci], opts.shadowBias);
                        float ndl = std::max(0.0f, dot(normal, -sun));
                        float light = 0.30f + 0.75f * ndl * lit;
                        Vec3 col = mat.albedo * light;
                        if (opts.tintCascades)
                            col = Vec3(col.x*cascadeTint[ci].x,
                                       col.y*cascadeTint[ci].y,
                                       col.z*cascadeTint[ci].z);
                        fb.depth[idx] = z;
                        fb.color[idx] = {
                            (uint8_t)std::clamp(col.x*255,0.0f,255.0f),
                            (uint8_t)std::clamp(col.y*255,0.0f,255.0f),
                            (uint8_t)std::clamp(col.z*255,0.0f,255.0f)};
                    }
                }
            }
        }
    }
}
