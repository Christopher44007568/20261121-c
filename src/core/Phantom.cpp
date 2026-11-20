#include "core/Phantom.h"

#include <algorithm>
#include <cmath>

namespace micro {
namespace {

double distanceToSegment(const Vec3 &point, const Vec3 &a, const Vec3 &b) {
    const Vec3 ab = b - a;
    const double denominator = ab.lengthSquared();
    if (denominator < 1e-12) {
        return distance(point, a);
    }
    const double t = clampd(dot(point - a, ab) / denominator, 0.0, 1.0);
    return distance(point, a + ab * t);
}

Vec3 axisFromTilt(double elevationDeg, double azimuthDeg) {
    const double elevation = degToRad(elevationDeg);
    const double azimuth = degToRad(azimuthDeg);
    return {std::cos(elevation) * std::cos(azimuth),
            std::cos(elevation) * std::sin(azimuth), std::sin(elevation)};
}

} // namespace

Phantom makeCalibrationPhantom() {
    Phantom phantom;
    auto &spec = phantom.spec;
    spec.geometry = {200, 160, 100, {5.0, 7.5, 12.0}, {0.0, 0.0, 0.0}};

    spec.sphereCenterUm = {282.5, 322.5, 349.0};
    spec.sphereDiameterUm = 320.0;

    spec.rodCenterUm = {650.0, 750.0, 700.0};
    spec.rodAxis = axisFromTilt(35.0, 25.0);
    spec.rodLengthUm = 720.0;
    spec.rodDiameterUm = 140.0;
    spec.rodTiltDeg = 35.0;

    spec.thinRodCenterUm = {300.0, 850.0, 700.0};
    spec.thinRodLengthUm = 500.0;
    spec.thinRodDiameterUm = 30.0;
    spec.thinRodTiltDeg = 35.0;

    const Vec3 fiducialAxis = axisFromTilt(35.0, 20.0);
    const Vec3 fiducialCenter{650.0, 1030.0, 650.0};
    spec.fiducialA = fiducialCenter - fiducialAxis * 350.0;
    spec.fiducialB = fiducialCenter + fiducialAxis * 350.0;
    spec.fiducialDiameterUm = 90.0;
    spec.fiducialLengthUm = distance(spec.fiducialA, spec.fiducialB);
    const Vec3 fiducialDelta = spec.fiducialB - spec.fiducialA;
    spec.fiducialTiltDeg =
        radToDeg(std::atan2(fiducialDelta.z,
                            std::hypot(fiducialDelta.x, fiducialDelta.y)));

    phantom.volume.reset(spec.geometry);
    auto &data = phantom.volume.data();
    const auto &geometry = spec.geometry;
    const double sphereRadius = spec.sphereDiameterUm * 0.5;
    const Vec3 rodA = spec.rodEndpointA();
    const Vec3 rodB = spec.rodEndpointB();
    const Vec3 thinA = spec.thinRodCenterUm - spec.rodAxis * (spec.thinRodLengthUm * 0.5);
    const Vec3 thinB = spec.thinRodCenterUm + spec.rodAxis * (spec.thinRodLengthUm * 0.5);
    const double fiducialRadius = spec.fiducialDiameterUm * 0.5;

    for (int z = 0; z < geometry.nz; ++z) {
        for (int y = 0; y < geometry.ny; ++y) {
            for (int x = 0; x < geometry.nx; ++x) {
                const Vec3 point = phantom.volume.indexToWorld({double(x), double(y), double(z)});
                double value = spec.background;

                if (distance(point, spec.sphereCenterUm) <= sphereRadius) {
                    value = spec.signal;
                }

                if (distanceToSegment(point, rodA, rodB) <=
                    spec.rodDiameterUm * 0.5) {
                    value = spec.signal;
                }
                if (distanceToSegment(point, thinA, thinB) <=
                    spec.thinRodDiameterUm * 0.5) {
                    value = spec.signal;
                }
                if (distance(point, spec.fiducialA) <= fiducialRadius ||
                    distance(point, spec.fiducialB) <= fiducialRadius) {
                    value = spec.signal;
                }

                const size_t index =
                    (static_cast<size_t>(z) * geometry.ny + y) * geometry.nx + x;
                data[index] = static_cast<float>(value);
            }
        }
    }
    phantom.volume.refreshRange();
    return phantom;
}

} // namespace micro

