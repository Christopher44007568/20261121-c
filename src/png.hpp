#pragma once

#include "render.hpp"

#include <cstdint>
#include <string>
#include <vector>

bool writePng(const std::string& path, const ImageRgb& image);
bool writePpm(const std::string& path, const ImageRgb& image);

ImageRgb composeHorizontal(const ImageRgb& left, const ImageRgb& right, int gap = 4);
ImageRgb composeGrid(const std::vector<ImageRgb>& images, int columns, int gap = 4);
void fillRect(ImageRgb& image, int x, int y, int width, int height,
              uint8_t r, uint8_t g, uint8_t b);
void drawCross(ImageRgb& image, int cx, int cy, int radius,
               uint8_t r, uint8_t g, uint8_t b);

