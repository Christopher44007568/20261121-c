#pragma once

#include "gl_api.hpp"

#include <string>

namespace oit {

class Font {
public:
    Font() = default;
    ~Font();

    bool create();
    oit::gl::GLuint texture() const { return texture_; }
    float textWidth(const std::string &text, float scale) const;
    float lineHeight(float scale) const { return 8.0f * scale; }
    int glyphIndex(char c) const;

private:
    oit::gl::GLuint texture_ = 0;
};

}  // namespace oit
