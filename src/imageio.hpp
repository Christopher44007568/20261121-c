#pragma once
#include "raster.hpp"
#include <string>

bool writePPM(const std::string& path, const ColorBuffer& fb);
// Stores shadow depth as 255 * (1 - depth): nearer casters look brighter.
bool writeShadowPGM(const std::string& path, const ColorBuffer& shadowMap);
