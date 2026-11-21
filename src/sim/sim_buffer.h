#ifndef SIM_BUFFER_H
#define SIM_BUFFER_H

#include <cassert>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

#include "shim_cpp.h"

// Generic 2D float buffer (RGBA color or XY/linear-depth G-buffer channels).
struct Buffer2D
{
    int width = 0;
    int height = 0;
    int channels = 0;
    std::vector<float> data;

    Buffer2D() = default;
    Buffer2D(int w, int h, int c) { Init(w, h, c); }

    void Init(int w, int h, int c)
    {
        width = w;
        height = h;
        channels = c;
        data.assign(static_cast<size_t>(w) * h * c, 0.0f);
    }

    float* At(int x, int y)
    {
        assert(x >= 0 && y >= 0 && x < width && y < height);
        return &data[(static_cast<size_t>(y) * width + x) * channels];
    }
    const float* At(int x, int y) const
    {
        assert(x >= 0 && y >= 0 && x < width && y < height);
        return &data[(static_cast<size_t>(y) * width + x) * channels];
    }

    float3 Rgb(int x, int y) const
    {
        const float* p = At(x, y);
        return float3(p[0], p[1], p[2]);
    }
};

// Linear-ish tone map + sRGB-ish gamma so error metrics work on display values.
inline float3 ToneMap(float3 c)
{
    c = c / (c + float3(1.0f));
    float g = 1.0f / 2.2f;
    return float3(std::pow(clamp(c.x, 0.0f, 1.0f), g),
                  std::pow(clamp(c.y, 0.0f, 1.0f), g),
                  std::pow(clamp(c.z, 0.0f, 1.0f), g));
}

// Dump an RGB buffer (values expected in 0..1) as a binary PPM image.
inline void WritePpm(const std::string& path, const Buffer2D& b)
{
    assert(b.channels >= 3);
    std::ofstream f(path, std::ios::binary);
    f << "P6\n" << b.width << " " << b.height << "\n255\n";
    std::vector<uint8_t> row(static_cast<size_t>(b.width) * 3);
    for (int y = 0; y < b.height; ++y)
    {
        for (int x = 0; x < b.width; ++x)
        {
            const float* p = b.At(x, y);
            for (int k = 0; k < 3; ++k)
                row[static_cast<size_t>(x) * 3 + k] =
                    static_cast<uint8_t>(clamp(p[k], 0.0f, 1.0f) * 255.0f + 0.5f);
        }
        f.write(reinterpret_cast<char*>(row.data()),
                static_cast<std::streamsize>(row.size()));
    }
}

#endif // SIM_BUFFER_H
