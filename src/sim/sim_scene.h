#ifndef SIM_SCENE_H
#define SIM_SCENE_H

#include <cmath>

#include "sim_buffer.h"

// ---- Small 3D math subset -------------------------------------------------

inline float dot(float3 a, float3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float dot(float2 a, float2 b) { return a.x * b.x + a.y * b.y; }
inline float3 cross(float3 a, float3 b)
{
    return float3(a.y * b.z - a.z * b.y,
                  a.z * b.x - a.x * b.z,
                  a.x * b.y - a.y * b.x);
}
inline float3 normalize(float3 v)
{
    float len = std::sqrt(dot(v, v));
    return len > 1e-8f ? v * (1.0f / len) : float3(0.0f);
}
inline float3 reflect(float3 v, float3 n) { return v - n * (2.0f * dot(v, n)); }

// Perspective camera. yaw jumps in the scripted shot create the velocity
// discontinuity test; the scene itself also contains sub-pixel thin lines.
struct Camera
{
    float3 pos = float3(0.0f, 1.0f, -6.0f);
    float yaw = 0.0f;
    float pitch = 0.0f;
    float fovY = 1.0048f; // ~57.6 deg, matches the DX11 renderer

    float3 Forward() const
    {
        float cy = std::cos(yaw), sy = std::sin(yaw);
        float cp = std::cos(pitch), sp = std::sin(pitch);
        return normalize(float3(sy * cp, sp, cy * cp));
    }

    // View ray for normalized screen coordinate ndc in [-1,1].
    float3 RayDir(float2 ndc, int width, int height) const
    {
        float aspect = (float)width / (float)height;
        float halfH = std::tan(fovY * 0.5f);
        float3 f = Forward();
        float3 right = normalize(cross(f, float3(0.0f, 1.0f, 0.0f)));
        float3 up = cross(right, f);
        return normalize(f + right * (ndc.x * halfH * aspect)
                           + up * (ndc.y * halfH));
    }
};

struct Sphere
{
    float3 center;
    float radius;
    float3 albedo;
    float roughness;
    float metallic;
    float3 motion; // per-frame world-space translation
};

struct Plane
{
    float3 point;
    float3 normal;
};

struct Scene
{
    std::vector<Sphere> spheres;
    Plane ground = { float3(0.0f, -1.0f, 0.0f), float3(0.0f, 1.0f, 0.0f) };
    // Two thin vertical emissive lines at different depths (thin-line shot).
    float3 lineA0 = float3(-1.35f, -0.85f, 1.8f);
    float3 lineA1 = float3(-1.35f,  0.95f, 1.8f);
    float3 lineB0 = float3(2.10f, -0.85f, 4.2f);
    float3 lineB1 = float3(2.10f,  1.25f, 4.2f);
    float lineRadius = 0.012f;

    Scene()
    {
        spheres = {
            { float3(-1.6f, 0.1f, 1.2f), 1.1f, float3(0.85f, 0.25f, 0.20f), 0.18f, 0.05f, float3(0.025f, 0.0f, 0.0f) },
            { float3( 0.3f,-0.2f, 2.6f), 0.8f, float3(0.25f, 0.55f, 0.90f), 0.35f, 0.10f, float3(-0.02f, 0.012f, 0.0f) },
            { float3( 1.7f, 0.4f, 0.4f), 0.7f, float3(0.95f, 0.80f, 0.25f), 0.60f, 0.90f, float3(0.0f, 0.0f, 0.0f) },
            { float3( 0.0f, 0.0f, 6.5f), 2.2f, float3(0.35f, 0.35f, 0.38f), 0.85f, 0.00f, float3(0.0f, 0.0f, 0.0f) }
        };
    }

    void Advance()
    {
        for (Sphere& s : spheres)
            s.center = s.center + s.motion;
    }
};

#endif // SIM_SCENE_H
