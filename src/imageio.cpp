#include "imageio.hpp"
#include <cstdio>
#include <algorithm>

bool writePPM(const std::string& path, const ColorBuffer& fb) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    std::fprintf(f, "P6\n%d %d\n255\n", fb.width, fb.height);
    std::fwrite(fb.color.data(), sizeof(RGB),
                fb.width * fb.height, f);
    std::fclose(f);
    return true;
}

bool writeShadowPGM(const std::string& path, const ColorBuffer& map) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    std::fprintf(f, "P5\n%d %d\n255\n", map.width, map.height);
    std::vector<uint8_t> gray(map.width * map.height);
    for (size_t i = 0; i < gray.size(); ++i) {
        float d = std::clamp(map.depth[i], 0.0f, 1.0f);
        gray[i] = static_cast<uint8_t>(std::round((1.0f - d) * 255.0f));
    }
    std::fwrite(gray.data(), 1, gray.size(), f);
    std::fclose(f);
    return true;
}
