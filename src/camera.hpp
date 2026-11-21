#pragma once
#include "math.hpp"

struct CameraParams {
    float fovYDeg = 50.0f;
    float aspect = 16.0f / 9.0f;
    float nearZ = 0.5f;
    float farZ = 110.0f;
};

struct CameraState {
    Vec3 pos;
    float yaw = 0;      // radians, 0 looks toward +x
    float pitch = 0;    // radians, positive looks up
    Vec3 forward() const;
    Vec3 right() const;
    Mat4 viewMatrix() const;
};

struct TrajectoryConfig {
    int frames = 360;
    float fps = 30.0f;
    float speed = 1.0f;                 // meters per second
    float eyeHeight = 1.7f;
    float pitchDeg = -12.0f;
    float yawSweepPeakToPeakDeg = 17.071f;
};

CameraState trajectoryFrame(const TrajectoryConfig& cfg, int frame);

// Eight world-space corners of a perspective frustum slice [near,far].
// Order: 0..3 near plane, 4..7 far plane; loops start at lower-left.
void frustumCorners(const CameraState& cam, const CameraParams& p,
                    float nearZ, float farZ, Vec3 out[8]);
