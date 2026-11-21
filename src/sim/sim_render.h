#ifndef SIM_RENDER_H
#define SIM_RENDER_H

#include "sim_shade.h"

// G-buffer layout: RGB = linear HDR color, channel 3 = linear view depth.
struct GBuffer
{
    Buffer2D color; // 4 channels
    Buffer2D motion; // 2 channels, pixels per frame in current-frame screen space

    void Init(int w, int h)
    {
        color.Init(w, h, 4);
        motion.Init(w, h, 2);
    }
};

inline Camera CameraAtFrame(int frame)
{
    Camera cam;
    // Slow push-in ...
    cam.pos.z = -6.0f + 0.02f * frame;
    cam.yaw = 0.10f * std::sin(frame * 0.09f);
    // ... sudden yaw jump (velocity discontinuity) on frames 20 and 41.
    if (frame >= 20) cam.yaw += 0.35f;
    if (frame >= 41) cam.yaw -= 0.55f;
    return cam;
}

// Project a world point to pixel coordinates under an arbitrary camera.
inline float2 ProjectWorld(float3 world, const Camera& cam, int w, int h)
{
    float3 f = cam.Forward();
    float3 right = normalize(cross(f, float3(0.0f, 1.0f, 0.0f)));
    float3 up = cross(right, f);
    float3 rel = world - cam.pos;
    float z = dot(rel, f);
    float halfH = std::tan(cam.fovY * 0.5f);
    float aspect = (float)w / (float)h;
    float nx = dot(rel, right) / (z * halfH * aspect);
    float ny = dot(rel, up) / (z * halfH);
    return float2((nx * 0.5f + 0.5f) * w, (0.5f - ny * 0.5f) * h);
}

inline void RenderFrame(const Scene& scene, const Camera& cam,
                        const Camera& prevCam, int w, int h,
                        float2 jitterPx, GBuffer& out)
{
    out.Init(w, h);
    for (int y = 0; y < h; ++y)
    {
        for (int x = 0; x < w; ++x)
        {
            // Pixel sample position includes the sub-pixel jitter.
            float sx = (x + 0.5f + jitterPx.x) / (float)w;
            float sy = (y + 0.5f + jitterPx.y) / (float)h;
            float2 ndc(sx * 2.0f - 1.0f, 1.0f - sy * 2.0f);
            float3 rd = cam.RayDir(ndc, w, h);
            Hit hit = Trace(scene, cam.pos, rd);
            float3 color = Shade(hit, rd);
            float depth = hit.ok ? dot(hit.pos - cam.pos, cam.Forward())
                                 : 1000.0f;
            float* cp = out.color.At(x, y);
            cp[0] = color.x; cp[1] = color.y; cp[2] = color.z; cp[3] = depth;

            float2 vel(0.0f);
            if (hit.ok)
            {
                float2 cur = ProjectWorld(hit.pos, cam, w, h);
                float2 old = ProjectWorld(hit.pos, prevCam, w, h);
                vel = cur - old;
            }
            else
            {
                // Sky / background: no world point to reproject, but the camera
                // rotation still makes the background flow across the screen.
                // Evaluate the view ray under both cameras at infinite distance.
                float3 rdOld = prevCam.RayDir(ndc, w, h);
                float2 oldPx = ProjectWorld(prevCam.pos + rdOld * 100.0f,
                                            prevCam, w, h);
                float2 curPx = ProjectWorld(cam.pos + rd * 100.0f, cam, w, h);
                vel = curPx - oldPx;
            }
            float* mp = out.motion.At(x, y);
            mp[0] = vel.x; mp[1] = vel.y;
        }
    }
}

#endif // SIM_RENDER_H
