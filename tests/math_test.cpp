#include "math.hpp"

#include <cmath>
#include <cstdio>

namespace {

bool nearly(float a, float b, float epsilon = 1.0e-5f) {
    return std::abs(a - b) <= epsilon;
}

}  // namespace

int main() {
    using namespace oit;
    int failures = 0;

    const Mat4 identityMatrix = identity();
    const Vec4 transformed = identityMatrix * Vec4{1.5f, -2.0f, 3.25f, 1.0f};
    if (!nearly(transformed.x, 1.5f) || !nearly(transformed.y, -2.0f) ||
        !nearly(transformed.z, 3.25f) || !nearly(transformed.w, 1.0f)) {
        std::fprintf(stderr, "identity transform failed\n");
        ++failures;
    }

    const Mat4 view = lookAt({0.0f, 0.0f, 5.0f}, {0.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f});
    const Vec3 origin = transformPoint(view, {0.0f, 0.0f, 0.0f});
    if (!nearly(origin.x, 0.0f) || !nearly(origin.y, 0.0f) || !nearly(origin.z, -5.0f)) {
        std::fprintf(stderr, "lookAt transform failed\n");
        ++failures;
    }

    const Vec3 normalized = normalize({3.0f, 4.0f, 0.0f});
    if (!nearly(length(normalized), 1.0f) || !nearly(normalized.x, 0.6f) ||
        !nearly(normalized.y, 0.8f)) {
        std::fprintf(stderr, "normalize failed\n");
        ++failures;
    }

    const Mat4 projection = perspective(radians(60.0f), 16.0f / 9.0f, 0.1f, 100.0f);
    if (!nearly(projection.m[11], -1.0f) || !(projection.m[10] < -1.0f)) {
        std::fprintf(stderr, "perspective projection failed\n");
        ++failures;
    }

    if (failures != 0) return 1;
    std::printf("math tests passed\n");
    return 0;
}
