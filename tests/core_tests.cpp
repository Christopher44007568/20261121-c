#include "core/Calibration.h"
#include "core/PlaneSampler.h"
#include "core/Phantom.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {

void require(bool condition, const char *message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

void requireNear(double actual, double expected, double tolerance,
                 const char *message) {
    if (std::abs(actual - expected) > tolerance) {
        std::cerr << message << ": actual=" << actual
                  << " expected=" << expected << " tolerance=" << tolerance
                  << "\n";
        throw std::runtime_error(message);
    }
}

void testPhysicalRoundTrip() {
    micro::VolumeGeometry geometry{7, 9, 5, {5.0, 7.5, 12.0}, {13.0, 21.0, -4.0}};
    micro::Volume volume(geometry);
    const micro::Vec3 index{3.25, 4.5, 2.75};
    const micro::Vec3 world = volume.indexToWorld(index);
    const micro::Vec3 recovered = volume.worldToIndex(world);
    requireNear(recovered.x, index.x, 1e-12, "X round trip");
    requireNear(recovered.y, index.y, 1e-12, "Y round trip");
    requireNear(recovered.z, index.z, 1e-12, "Z round trip");
    requireNear(geometry.extentUm().x, 30.0, 1e-12, "X physical extent");
    requireNear(geometry.extentUm().y, 60.0, 1e-12, "Y physical extent");
    requireNear(geometry.extentUm().z, 48.0, 1e-12, "Z physical extent");
}

void testPlaneUsesPhysicalAxes() {
    const micro::SlicePlane plane =
        micro::makeTiltedPlane({100.0, 200.0, 300.0}, 35.0, -12.0, 250.0, 180.0);
    const micro::Vec3 a = plane.pointAt(-250.0, 0.0);
    const micro::Vec3 b = plane.pointAt(250.0, 0.0);
    requireNear(micro::distance(a, b), 500.0, 1e-10, "Plane U distance");
    const micro::Vec3 c = plane.pointAt(0.0, -180.0);
    const micro::Vec3 d = plane.pointAt(0.0, 180.0);
    requireNear(micro::distance(c, d), 360.0, 1e-10, "Plane V distance");
    requireNear(plane.uAxis.length(), 1.0, 1e-12, "U axis normalized");
    requireNear(plane.vAxis.length(), 1.0, 1e-12, "V axis normalized");
    requireNear(micro::dot(plane.uAxis, plane.vAxis), 0.0, 1e-12,
                "Plane basis orthogonal");
}

void testInterpolationAtVoxelCenters() {
    micro::Volume volume({3, 3, 3, {2.0, 3.0, 4.0}, {0.0, 0.0, 0.0}});
    volume.at(1, 1, 1) = 1.0f;
    for (micro::Interpolation mode :
         {micro::Interpolation::Nearest, micro::Interpolation::Linear,
          micro::Interpolation::Cubic}) {
        requireNear(volume.sampleWorld({2.0, 3.0, 4.0}, mode), 1.0, 1e-6,
                    "Voxel-center interpolation");
    }
    requireNear(volume.sampleWorld({0.0, 0.0, 0.0},
                                   micro::Interpolation::Linear),
                0.0, 1e-6, "Outside signal remains zero");
}

void testCalibration() {
    const micro::Phantom phantom = micro::makeCalibrationPhantom();
    const micro::ValidationReport report = micro::runValidation(phantom);
    require(report.rows.size() == 3, "Three interpolation rows");

    for (const auto &row : report.rows) {
        require(row.thinRod.diameterUm > 0.0, "Measured thin rod width");
        require(row.fiducialLengthUm > 0.0, "Measured fiducial distance");
        if (row.interpolation != micro::Interpolation::Nearest) {
            require(std::abs(row.fiducialLengthErrorPct) < 2.0,
                    "Sub-2% fiducial distance error");
            require(std::abs(row.fiducialTiltErrorDeg) < 1.0,
                    "Sub-degree tilt error");
            require(std::abs(row.sphereMeanErrorPct) < 4.0,
                    "Sub-4% sphere diameter error");
        }
    }
    const auto cubic = std::find_if(
        report.rows.begin(), report.rows.end(), [](const auto &row) {
            return row.interpolation == micro::Interpolation::Cubic;
        });
    const auto linear = std::find_if(
        report.rows.begin(), report.rows.end(), [](const auto &row) {
            return row.interpolation == micro::Interpolation::Linear;
        });
    require(cubic != report.rows.end() && linear != report.rows.end(),
            "Interpolation comparison rows present");
    require(cubic->thinRod.peak > linear->thinRod.peak + 0.03,
            "Cubic ringing is visible on the sub-slice-thickness rod");
    require(cubic->thinRod.diameterUm > linear->thinRod.diameterUm,
            "Cubic broadens the thin-rod FWHM in this calibration");
    std::cout << report.markdown() << "\n";
}

} // namespace

int main() {
    try {
        testPhysicalRoundTrip();
        testPlaneUsesPhysicalAxes();
        testInterpolationAtVoxelCenters();
        testCalibration();
        std::cout << "All core tests passed.\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "Test failure: " << error.what() << "\n";
        return 1;
    }
}

