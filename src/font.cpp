#include "font.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <vector>

namespace oit {

namespace {

struct Glyph {
    char c;
    std::array<std::uint8_t, 7> rows;
};

constexpr std::array<Glyph, 50> kGlyphs{{
    {' ', {0, 0, 0, 0, 0, 0, 0}},
    {'A', {14, 17, 17, 31, 17, 17, 17}},
    {'B', {30, 17, 17, 30, 17, 17, 30}},
    {'C', {15, 16, 16, 16, 16, 16, 15}},
    {'D', {30, 17, 17, 17, 17, 17, 30}},
    {'E', {31, 16, 16, 30, 16, 16, 31}},
    {'F', {31, 16, 16, 30, 16, 16, 16}},
    {'G', {15, 16, 16, 23, 17, 17, 15}},
    {'H', {17, 17, 17, 31, 17, 17, 17}},
    {'I', {31, 4, 4, 4, 4, 4, 31}},
    {'J', {7, 2, 2, 2, 18, 18, 12}},
    {'K', {17, 18, 20, 24, 20, 18, 17}},
    {'L', {16, 16, 16, 16, 16, 16, 31}},
    {'M', {17, 27, 21, 21, 17, 17, 17}},
    {'N', {17, 25, 21, 19, 17, 17, 17}},
    {'O', {14, 17, 17, 17, 17, 17, 14}},
    {'P', {30, 17, 17, 30, 16, 16, 16}},
    {'Q', {14, 17, 17, 17, 21, 18, 13}},
    {'R', {30, 17, 17, 30, 20, 18, 17}},
    {'S', {15, 16, 16, 14, 1, 1, 30}},
    {'T', {31, 4, 4, 4, 4, 4, 4}},
    {'U', {17, 17, 17, 17, 17, 17, 14}},
    {'V', {17, 17, 17, 17, 17, 10, 4}},
    {'W', {17, 17, 17, 21, 21, 21, 10}},
    {'X', {17, 17, 10, 4, 10, 17, 17}},
    {'Y', {17, 17, 10, 4, 4, 4, 4}},
    {'Z', {31, 1, 2, 4, 8, 16, 31}},
    {'0', {14, 17, 19, 21, 25, 17, 14}},
    {'1', {4, 12, 4, 4, 4, 4, 14}},
    {'2', {14, 17, 1, 2, 4, 8, 31}},
    {'3', {30, 1, 1, 14, 1, 1, 30}},
    {'4', {2, 6, 10, 18, 31, 2, 2}},
    {'5', {31, 16, 16, 30, 1, 1, 30}},
    {'6', {14, 16, 16, 30, 17, 17, 14}},
    {'7', {31, 1, 2, 4, 8, 8, 8}},
    {'8', {14, 17, 17, 14, 17, 17, 14}},
    {'9', {14, 17, 17, 15, 1, 1, 14}},
    {':', {0, 4, 4, 0, 4, 4, 0}},
    {'.', {0, 0, 0, 0, 0, 12, 12}},
    {'/', {1, 2, 2, 4, 8, 8, 16}},
    {'-', {0, 0, 0, 31, 0, 0, 0}},
    {'+', {0, 4, 4, 31, 4, 4, 0}},
    {'%', {24, 25, 2, 4, 8, 19, 3}},
    {'(', {2, 4, 8, 8, 8, 4, 2}},
    {')', {8, 4, 2, 2, 2, 4, 8}},
    {'[', {14, 8, 8, 8, 8, 8, 14}},
    {']', {14, 2, 2, 2, 2, 2, 14}},
    {'<', {2, 4, 8, 16, 8, 4, 2}},
    {'>', {8, 4, 2, 1, 2, 4, 8}},
    {'=', {0, 31, 0, 31, 0, 0, 0}},
}};

constexpr int kAtlasCols = 16;
constexpr int kAtlasRows = 8;
constexpr int kCell = 8;
constexpr int kAtlasWidth = kAtlasCols * kCell;
constexpr int kAtlasHeight = kAtlasRows * kCell;

}  // namespace

Font::~Font() {
    if (texture_) gl::DeleteTextures(1, &texture_);
}

bool Font::create() {
    if (texture_) return true;
    std::vector<std::uint8_t> pixels(kAtlasWidth * kAtlasHeight * 4, 0);
    for (std::size_t i = 0; i < kGlyphs.size(); ++i) {
        const int cellX = static_cast<int>(i % kAtlasCols) * kCell;
        const int cellY = static_cast<int>(i / kAtlasCols) * kCell;
        for (int row = 0; row < 7; ++row) {
            for (int col = 0; col < 5; ++col) {
                const bool on = (kGlyphs[i].rows[row] & (1u << (4 - col))) != 0;
                if (!on) continue;
                const int x = cellX + 1 + col;
                const int y = cellY + 1 + row;
                const std::size_t offset = static_cast<std::size_t>(y * kAtlasWidth + x) * 4;
                pixels[offset + 0] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
                pixels[offset + 3] = 255;
            }
        }
    }

    gl::GenTextures(1, &texture_);
    gl::BindTexture(gl::GL_TEXTURE_2D, texture_);
    gl::PixelStorei(gl::GL_UNPACK_ALIGNMENT, 1);
    gl::TexImage2D(gl::GL_TEXTURE_2D, 0, gl::GL_RGBA8, kAtlasWidth, kAtlasHeight, 0,
                   gl::GL_RGBA, gl::GL_UNSIGNED_BYTE, pixels.data());
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MIN_FILTER, gl::GL_NEAREST);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_MAG_FILTER, gl::GL_NEAREST);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_WRAP_S, gl::GL_CLAMP_TO_EDGE);
    gl::TexParameteri(gl::GL_TEXTURE_2D, gl::GL_TEXTURE_WRAP_T, gl::GL_CLAMP_TO_EDGE);
    gl::BindTexture(gl::GL_TEXTURE_2D, 0);
    return texture_ != 0;
}

int Font::glyphIndex(char c) const {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    for (std::size_t i = 0; i < kGlyphs.size(); ++i) {
        if (kGlyphs[i].c == c) return static_cast<int>(i);
    }
    return 0;
}

float Font::textWidth(const std::string &text, float scale) const {
    return static_cast<float>(text.size()) * 6.0f * scale;
}

}  // namespace oit
