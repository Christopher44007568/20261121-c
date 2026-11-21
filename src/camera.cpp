#include "camera.hpp"

Vec3 CameraState::forward() const {
    float cp = std::cos(pitch);
    return {std::cos(yaw) * cp, std::sin(pitch), std::sin(yaw) * cp};
}

Vec3 CameraState::right() const {
    return normalize(cross(forward(), {0, 1, 0}));
}

Mat4 CameraState::viewMatrix() const {
    Vec3 f = forward();
    Vec3 u = normalize(cross(right(), f));
    return lookAt(pos, pos + f, u);
}

CameraState trajectoryFrame(const TrajectoryConfig& cfg, int frame) {
    CameraState cam;
    float t = frame / cfg.fps;
    cam.pos = {cfg.speed * t, cfg.eyeHeight, 0.0f};
    // Full peak-to-peak sweep completes one sine period over the clip.
    float halfSweep = cfg.yawSweepPeakToPeakDeg * 0.5f
                    * 3.14159265f / 180.0f;
    float phase = 2.0f * 3.14159265f * frame / cfg.frames;
    cam.yaw = halfSweep * std::sin(phase);
    cam.pitch = cfg.pitchDeg * 3.14159265f / 180.0f;
    return cam;
}

void frustumCorners(const CameraState& cam, const CameraParams& p,
                    float nearZ, float farZ, Vec3 out[8]) {
    float tanHalfY = std::tan(p.fovYDeg * 0.5f * 3.14159265f / 180.0f);
    float tanHalfX = tanHalfY * p.aspect;
    Vec3 f = cam.forward();
    Vec3 r = cam.right();
    Vec3 u = normalize(cross(r, f));
    const float depth[2] = {nearZ, farZ};
    int idx = 0;
    for (int d = 0; d < 2; ++d) {
        float z = depth[d];
        Vec3 center = cam.pos + f * z;
        Vec3 hx = r * (z * tanHalfX);
        Vec3 hy = u * (z * tanHalfY);
        out[idx++] = center - hx - hy;
        out[idx++] = center + hx - hy;
        out[idx++] = center + hx + hy;
        out[idx++] = center - hx + hy;
    }
}
