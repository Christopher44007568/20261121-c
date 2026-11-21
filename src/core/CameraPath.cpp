#include "core/CameraPath.h"

#include <algorithm>
#include <cmath>

namespace pcloud {
namespace {

double smoothStep(double value) {
    const double t = std::clamp(value, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

Vec3 lerp(const Vec3& left, const Vec3& right, double t) {
    return left * (1.0 - t) + right * t;
}

}  // namespace

CameraPath::CameraPath(std::vector<Keyframe> keyframes)
    : keyframes_(std::move(keyframes)) {
    if (!keyframes_.empty()) {
        duration_ = std::max(0.0, keyframes_.back().time);
    }
}

CameraPath CameraPath::orbitAround(const Box3& bounds,
                                   double durationSeconds,
                                   int keyframeCount) {
    std::vector<Keyframe> frames;
    const int count = std::max(4, keyframeCount);
    const Vec3 center = bounds.center();
    const double radius = std::max(6.0, bounds.diagonal() * 0.95);
    const double duration = std::max(1.0, durationSeconds);

    for (int index = 0; index <= count; ++index) {
        const double fraction = static_cast<double>(index) / count;
        const double angle = 0.6 + fraction * 2.0 * kPi;
        const double radial = radius * (0.88 + 0.12 * std::sin(fraction * 4.0 * kPi));
        const double height =
            center.y + radius * (0.22 + 0.16 * std::sin(fraction * 3.0 * kPi + 0.4));
        frames.push_back(Keyframe{
            fraction * duration,
            {center.x + std::cos(angle) * radial, height, center.z + std::sin(angle) * radial},
            center,
        });
    }
    return CameraPath(std::move(frames));
}

CameraView CameraPath::at(double seconds,
                          int viewportHeight,
                          double verticalFovDegrees) const {
    CameraView camera;
    camera.viewportHeight = viewportHeight;
    camera.verticalFovDegrees = verticalFovDegrees;
    if (keyframes_.empty()) {
        camera.position = {0.0, 0.0, 20.0};
        return camera;
    }
    if (keyframes_.size() == 1 || duration_ <= 0.0) {
        camera.position = keyframes_.front().position;
        camera.target = keyframes_.front().target;
        return camera;
    }

    double wrapped = std::fmod(seconds, duration_);
    if (wrapped < 0.0) {
        wrapped += duration_;
    }
    auto upper = std::upper_bound(
        keyframes_.begin(), keyframes_.end(), wrapped,
        [](double value, const Keyframe& frame) { return value < frame.time; });
    if (upper == keyframes_.begin()) {
        camera.position = keyframes_.front().position;
        camera.target = keyframes_.front().target;
        return camera;
    }
    if (upper == keyframes_.end()) {
        camera.position = keyframes_.back().position;
        camera.target = keyframes_.back().target;
        return camera;
    }
    const Keyframe& to = *upper;
    const Keyframe& from = *(upper - 1);
    const double span = std::max(1e-9, to.time - from.time);
    const double t = smoothStep((wrapped - from.time) / span);
    camera.position = lerp(from.position, to.position, t);
    camera.target = lerp(from.target, to.target, t);
    return camera;
}

std::vector<CameraView> CameraPath::lookahead(double seconds,
                                              int count,
                                              double spacingSeconds,
                                              int viewportHeight,
                                              double verticalFovDegrees) const {
    std::vector<CameraView> cameras;
    const int safeCount = std::clamp(count, 0, 16);
    cameras.reserve(static_cast<std::size_t>(safeCount));
    for (int index = 1; index <= safeCount; ++index) {
        cameras.push_back(at(
            seconds + spacingSeconds * static_cast<double>(index),
            viewportHeight,
            verticalFovDegrees));
    }
    return cameras;
}

}  // namespace pcloud
