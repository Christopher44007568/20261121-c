#ifndef SIM_SHADE_H
#define SIM_SHADE_H

#include <limits>

#include "sim_scene.h"

struct Hit
{
    bool ok = false;
    float t = std::numeric_limits<float>::infinity();
    float3 pos;
    float3 normal;
    float3 albedo = float3(0.5f);
    float roughness = 0.5f;
    float metallic = 0.0f;
    float emissive = 0.0f; // 1 on the thin lines, 0 elsewhere
};

inline bool IntersectSphere(const Sphere& s, float3 ro, float3 rd, Hit& hit)
{
    float3 oc = ro - s.center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - s.radius * s.radius;
    float disc = b * b - c;
    if (disc <= 0.0f) return false;
    float sq = std::sqrt(disc);
    float t = -b - sq;
    if (t <= 0.001f) t = -b + sq;
    if (t <= 0.001f || t >= hit.t) return false;
    hit.t = t;
    hit.pos = ro + rd * t;
    hit.normal = normalize(hit.pos - s.center);
    hit.albedo = s.albedo;
    hit.roughness = s.roughness;
    hit.metallic = s.metallic;
    return true;
}

inline bool IntersectPlane(const Plane& p, float3 ro, float3 rd, Hit& hit)
{
    float denom = dot(p.normal, rd);
    if (std::fabs(denom) < 1e-5f) return false;
    float t = dot(p.point - ro, p.normal) / denom;
    if (t <= 0.001f || t >= hit.t) return false;
    hit.t = t;
    hit.pos = ro + rd * t;
    hit.normal = p.normal;
    // High-frequency checker plus thin sine stripes: the projected pattern is
    // finer than a low-resolution pixel, so sub-pixel jitter changes each
    // pixel's coverage every frame and temporal accumulation has real aliasing
    // energy to converge (mirrors the thin-line/geometry AA test in the DX11 app).
    int cx = (int)std::floor(hit.pos.x * 2.0f);
    int cz = (int)std::floor(hit.pos.z * 2.0f);
    float k = ((cx + cz) & 1) ? 0.45f : 0.80f;
    float stripe = 0.5f + 0.5f *
        std::sin((hit.pos.x * 9.0f + hit.pos.z * 7.0f) * (float)M_PI);
    k *= 0.85f + 0.30f * stripe;
    hit.albedo = float3(k);
    hit.roughness = 0.75f;
    hit.metallic = 0.0f;
    return true;
}

// Infinite thin cylinder used for the emissive lines.
inline bool IntersectLine(float3 p0, float3 p1, float radius,
                          float3 ro, float3 rd, Hit& hit)
{
    float3 axis = normalize(p1 - p0);
    float3 rel = ro - p0;
    float3 dPerp = rd - axis * dot(rd, axis);
    float3 rPerp = rel - axis * dot(rel, axis);
    float a = dot(dPerp, dPerp);
    float b = 2.0f * dot(dPerp, rPerp);
    float c = dot(rPerp, rPerp) - radius * radius;
    float disc = b * b - 4.0f * a * c;
    if (a < 1e-8f || disc <= 0.0f) return false;
    float sq = std::sqrt(disc);
    float t = (-b - sq) / (2.0f * a);
    if (t <= 0.001f || t >= hit.t) return false;
    float3 q = ro + rd * t;
    float along = dot(q - p0, axis);
    float len = std::sqrt(dot(p1 - p0, p1 - p0));
    if (along < 0.0f || along > len) return false;
    hit.t = t;
    hit.pos = q;
    hit.normal = normalize(q - (p0 + axis * along));
    hit.albedo = float3(1.0f, 0.95f, 0.85f);
    hit.roughness = 0.2f;
    hit.metallic = 0.0f;
    hit.emissive = 1.0f;
    return true;
}

inline Hit Trace(const Scene& sc, float3 ro, float3 rd)
{
    Hit hit;
    for (const Sphere& s : sc.spheres) IntersectSphere(s, ro, rd, hit);
    IntersectPlane(sc.ground, ro, rd, hit);
    IntersectLine(sc.lineA0, sc.lineA1, sc.lineRadius, ro, rd, hit);
    IntersectLine(sc.lineB0, sc.lineB1, sc.lineRadius, ro, rd, hit);
    hit.ok = std::isfinite(hit.t);
    return hit;
}

// ---- Cook-Torrance style PBR (single directional + ambient) ----------------

inline float DistributionGGX(float3 n, float3 h, float rough)
{
    float a = rough * rough;
    float a2 = a * a;
    float ndh = std::max(dot(n, h), 0.0f);
    float d = ndh * ndh * (a2 - 1.0f) + 1.0f;
    return a2 / std::max((float)M_PI * d * d, 1e-7f);
}

inline float GeometrySmith(float3 n, float3 v, float3 l, float rough)
{
    float r = rough + 1.0f;
    float k = (r * r) / 8.0f;
    auto schlick = [&](float cosTheta) {
        return cosTheta / (cosTheta * (1.0f - k) + k);
    };
    return schlick(std::max(dot(n, v), 0.0f)) *
           schlick(std::max(dot(n, l), 0.0f));
}

inline float3 FresnelSchlick(float cosTheta, float3 f0)
{
    return f0 + (float3(1.0f) - f0) *
                std::pow(std::max(1.0f - cosTheta, 0.0f), 5.0f);
}

inline float3 Shade(const Hit& hit, float3 rd)
{
    if (!hit.ok)
    {
        float t = rd.y * 0.5f + 0.5f;
        return float3(0.18f, 0.24f, 0.35f) * (1.0f - t)
             + float3(0.45f, 0.58f, 0.75f) * t;
    }
    if (hit.emissive > 0.5f) return hit.albedo * 6.0f;

    float3 n = hit.normal;
    float3 v = rd * -1.0f;
    // Procedural micro-detail so jittered samples vary inside a footprint even
    // away from silhouette edges (procedural version of a detail normal map).
    float micro = 0.5f + 0.5f *
        std::sin(hit.pos.x * 14.0f + hit.pos.y * 9.0f - hit.pos.z * 6.0f);
    float3 albedo = hit.albedo * (0.80f + 0.40f * micro);
    float3 l = normalize(float3(-0.55f, 0.85f, -0.35f));
    float3 h = normalize(v + l);
    float3 f0 = float3(0.04f) * (1.0f - hit.metallic)
              + albedo * hit.metallic;

    float ndf = DistributionGGX(n, h, std::max(hit.roughness, 0.05f));
    float geo = GeometrySmith(n, v, l, std::max(hit.roughness, 0.05f));
    float3 fres = FresnelSchlick(std::max(dot(h, v), 0.0f), f0);
    float3 specular = (ndf * geo * fres) /
        std::max(4.0f * std::max(dot(n, v), 0.0f) *
                        std::max(dot(n, l), 0.0f), 1e-4f);
    float3 kd = (float3(1.0f) - fres) * (1.0f - hit.metallic);
    float ndl = std::max(dot(n, l), 0.0f);

    float3 ambient = albedo * (0.06f + 0.04f * std::max(n.y, 0.0f));
    return ambient + (kd * albedo / (float)M_PI + specular) *
                     (3.2f * ndl);
}

#endif // SIM_SHADE_H
