#pragma once

#include "core/Volume.h"

namespace micro {

struct PhantomSpec {
    VolumeGeometry geometry;

    Vec3 sphereCenterUm;
    double sphereDiameterUm = 320.0;

    Vec3 rodCenterUm;
    Vec3 rodAxis;
    double rodLengthUm = 720.0;
    double rodDiameterUm = 140.0;
    double rodTiltDeg = 35.0;

    Vec3 thinRodCenterUm;
    double thinRodLengthUm = 500.0;
    double thinRodDiameterUm = 50.0;
    double thinRodTiltDeg = 35.0;

    Vec3 fiducialA;
    Vec3 fiducialB;
    double fiducialDiameterUm = 90.0;
    double fiducialLengthUm = 700.0;
    double fiducialTiltDeg = 35.0;

    double background = 0.02;
    double signal = 1.0;
    double threshold = 0.5;

    Vec3 rodEndpointA() const {
        return rodCenterUm - rodAxis * (rodLengthUm * 0.5);
    }
    Vec3 rodEndpointB() const {
        return rodCenterUm + rodAxis * (rodLengthUm * 0.5);
    }
};

struct Phantom {
    Volume volume;
    PhantomSpec spec;
};

Phantom makeCalibrationPhantom();

} // namespace micro

