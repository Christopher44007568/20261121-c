#include "png.hpp"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <fstream>

extern "C" {
unsigned long compressBound(unsigned long sourceLength);
int compress2(unsigned char* dest, unsigned long* destLength,
              const unsigned char* source, unsigned long sourceLength, int level);
}

namespace {

uint32_t crc32Update(uint32_t crc, const uint8_t* data, size_t size) {
    static std::array<uint32_t, 256> table{};
    static bool ready = false;
    if (!ready) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int k = 0; k < 8; ++k) {
                c = (c & 1U) ? 0xEDB88320U ^ (c >> 1U) : c >> 1U;
            }
            table[i] = c;
        }
        ready = true;
    }
    for (size_t i = 0; i < size; ++i) {
        crc = table[(crc ^ data[i]) & 0xFFU] ^ (crc >> 8U);
    }
    return crc;
}

void putU32(std::vector<uint8_t>& out, uint32_t value) {
    out.push_back(static_cast<uint8_t>((value >> 24U) & 0xFFU));
    out.push_back(static_cast<uint8_t>((value >> 16U) & 0xFFU));
    out.push_back(static_cast<uint8_t>((value >> 8U) & 0xFFU));
    out.push_back(static_cast<uint8_t>(value & 0xFFU));
}

void writeChunk(std::vector<uint8_t>& out, const char type[4],
                const std::vector<uint8_t>& payload) {
    putU32(out, static_cast<uint32_t>(payload.size()));
    const size_t crcStart = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), payload.begin(), payload.end());
    const uint32_t crc = crc32Update(0xFFFFFFFFU, out.data() + crcStart,
                                     out.size() - crcStart) ^ 0xFFFFFFFFU;
    putU32(out, crc);
}

}  // namespace

bool writePng(const std::string& path, const ImageRgb& image) {
    if (image.width <= 0 || image.height <= 0 ||
        image.pixels.size() != static_cast<size_t>(image.width) * image.height * 3) {
        return false;
    }
    std::vector<uint8_t> raw(static_cast<size_t>(image.height) *
                             (1 + static_cast<size_t>(image.width) * 3));
    for (int y = 0; y < image.height; ++y) {
        const size_t rowStart = static_cast<size_t>(y) *
                                (1 + static_cast<size_t>(image.width) * 3);
        raw[rowStart] = 0;
        std::memcpy(raw.data() + rowStart + 1,
                    image.pixels.data() + static_cast<size_t>(y) * image.width * 3,
                    static_cast<size_t>(image.width) * 3);
    }
    unsigned long compressedSize = compressBound(static_cast<unsigned long>(raw.size()));
    std::vector<uint8_t> compressed(compressedSize);
    if (compress2(compressed.data(), &compressedSize, raw.data(),
                  static_cast<unsigned long>(raw.size()), 6) != 0) {
        return false;
    }
    compressed.resize(compressedSize);

    std::vector<uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<uint8_t> header;
    putU32(header, static_cast<uint32_t>(image.width));
    putU32(header, static_cast<uint32_t>(image.height));
    header.insert(header.end(), {8, 2, 0, 0, 0});
    writeChunk(png, "IHDR", header);
    writeChunk(png, "IDAT", compressed);
    writeChunk(png, "IEND", {});

    std::ofstream stream(path, std::ios::binary);
    stream.write(reinterpret_cast<const char*>(png.data()),
                 static_cast<std::streamsize>(png.size()));
    return stream.good();
}

bool writePpm(const std::string& path, const ImageRgb& image) {
    std::ofstream stream(path, std::ios::binary);
    if (!stream) {
        return false;
    }
    stream << "P6\n" << image.width << ' ' << image.height << "\n255\n";
    stream.write(reinterpret_cast<const char*>(image.pixels.data()),
                 static_cast<std::streamsize>(image.pixels.size()));
    return stream.good();
}

ImageRgb composeHorizontal(const ImageRgb& left, const ImageRgb& right, int gap) {
    ImageRgb result;
    result.width = left.width + gap + right.width;
    result.height = std::max(left.height, right.height);
    result.pixels.assign(static_cast<size_t>(result.width) * result.height * 3, 0);
    const auto blit = [&](const ImageRgb& image, int offsetX) {
        for (int y = 0; y < image.height; ++y) {
            for (int x = 0; x < image.width; ++x) {
                const size_t src = (static_cast<size_t>(y) * image.width + x) * 3;
                const size_t dst = (static_cast<size_t>(y) * result.width +
                                    offsetX + x) * 3;
                result.pixels[dst + 0] = image.pixels[src + 0];
                result.pixels[dst + 1] = image.pixels[src + 1];
                result.pixels[dst + 2] = image.pixels[src + 2];
            }
        }
    };
    blit(left, 0);
    fillRect(result, left.width, 0, gap, result.height, 218, 226, 236);
    blit(right, left.width + gap);
    return result;
}

ImageRgb composeGrid(const std::vector<ImageRgb>& images, int columns, int gap) {
    if (images.empty() || columns <= 0) {
        return {};
    }
    const int rows = (static_cast<int>(images.size()) + columns - 1) / columns;
    const int cellWidth = images[0].width;
    const int cellHeight = images[0].height;
    ImageRgb result;
    result.width = columns * cellWidth + (columns - 1) * gap;
    result.height = rows * cellHeight + (rows - 1) * gap;
    result.pixels.assign(static_cast<size_t>(result.width) * result.height * 3, 28);
    for (size_t i = 0; i < images.size(); ++i) {
        const int col = static_cast<int>(i) % columns;
        const int row = static_cast<int>(i) / columns;
        const ImageRgb& image = images[i];
        for (int y = 0; y < cellHeight; ++y) {
            for (int x = 0; x < cellWidth; ++x) {
                const size_t src = (static_cast<size_t>(y) * image.width + x) * 3;
                const size_t dst = (static_cast<size_t>(row * (cellHeight + gap) + y) *
                                    result.width + col * (cellWidth + gap) + x) * 3;
                result.pixels[dst + 0] = image.pixels[src + 0];
                result.pixels[dst + 1] = image.pixels[src + 1];
                result.pixels[dst + 2] = image.pixels[src + 2];
            }
        }
    }
    return result;
}

void fillRect(ImageRgb& image, int x, int y, int width, int height,
              uint8_t r, uint8_t g, uint8_t b) {
    const int x0 = std::clamp(x, 0, image.width);
    const int y0 = std::clamp(y, 0, image.height);
    const int x1 = std::clamp(x + width, 0, image.width);
    const int y1 = std::clamp(y + height, 0, image.height);
    for (int py = y0; py < y1; ++py) {
        for (int px = x0; px < x1; ++px) {
            const size_t index = (static_cast<size_t>(py) * image.width + px) * 3;
            image.pixels[index + 0] = r;
            image.pixels[index + 1] = g;
            image.pixels[index + 2] = b;
        }
    }
}

void drawCross(ImageRgb& image, int cx, int cy, int radius,
               uint8_t r, uint8_t g, uint8_t b) {
    for (int d = -radius; d <= radius; ++d) {
        fillRect(image, cx + d, cy, 1, 1, r, g, b);
        fillRect(image, cx, cy + d, 1, 1, r, g, b);
    }
    fillRect(image, cx - 1, cy - 1, 3, 3, r, g, b);
}
