#pragma once

#include "core/Phantom.h"

#include <optional>
#include <string>
#include <vector>

namespace micro {

struct ProfileResult {
    double diameterUm = 0.0;
    double peak = 0.0;
    double positiveRadiusUm = 0.0;
    double negativeRadiusUm = 0.0;
};

struct InterpolationValidation {
    Interpolation interpolation = Interpolation::Linear;
    double sphereDiameter[3] = {0.0, 0.0, 0.0};
    double sphereMeanDiameterUm = 0.0;
    double sphereMeanErrorPct = 0.0;
    ProfileResult thickRod;
    ProfileResult thinRod;
    Vec3 measuredFiducialA;
    Vec3 measuredFiducialB;
    double fiducialLengthUm = 0.0;
    double fiducialTiltDeg = 0.0;
    double fiducialLengthErrorPct = 0.0;
    double fiducialTiltErrorDeg = 0.0;
};

struct ValidationReport {
    PhantomSpec spec;
    std::vector<InterpolationValidation> rows;
    std::string markdown() const;
};

std::optional<ProfileResult> measureProfile(const Volume &volume, const Vec3 &center,
                                            const Vec3 &direction,
                                            double searchRadiusUm,
                                            double stepUm, double threshold,
                                            Interpolation interpolation);

InterpolationValidation validateInterpolation(const Phantom &phantom,
                                              Interpolation interpolation);
ValidationReport runValidation(const Phantom &phantom);

} // namespace micro

