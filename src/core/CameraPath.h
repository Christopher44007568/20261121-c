#pragma once

#include "core/Geometry.h"

#include <vector>

namespace pcloud {

class CameraPath {
public:
    struct Keyframe {
        double time = 0.0;
        Vec3 position;
        Vec3 target;
    };

    CameraPath() = default;
    explicit CameraPath(std::vector<Keyframe> keyframes);

    static CameraPath orbitAround(const Box3& bounds,
                                  double durationSeconds = 24.0,
                                  int keyframeCount = 10);

    CameraView at(double seconds,
                  int viewportHeight = 900,
                  double verticalFovDegrees = 45.0) const;

    std::vector<CameraView> lookahead(double seconds,
                                      int count,
                                      double spacingSeconds,
                                      int viewportHeight = 900,
                                      double verticalFovDegrees = 45.0) const;

    double duration() const { return duration_; }
    bool empty() const { return keyframes_.empty(); }

private:
    std::vector<Keyframe> keyframes_;
    double duration_ = 0.0;
};

}  // namespace pcloud
