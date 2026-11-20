#pragma once

#include "core/Geometry.h"

namespace microqt {

struct Measurement {
    micro::Vec3 aUm;
    micro::Vec3 bUm;

    double lengthUm() const { return micro::distance(aUm, bUm); }
    double elevationDeg() const {
        const micro::Vec3 delta = bUm - aUm;
        return micro::radToDeg(
            std::atan2(delta.z, std::hypot(delta.x, delta.y)));
    }
};

} // namespace microqt

