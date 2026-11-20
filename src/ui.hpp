#pragma once

#include "font.hpp"
#include "math.hpp"
#include "platform.hpp"

#include <string>
#include <vector>

namespace oit {

class Ui {
public:
    bool create(Font *font, std::string *error);
    void begin(int width, int height, const InputState &input);
    void end();
    void rect(float x, float y, float width, float height, Vec4 color);
    void text(float x, float y, float scale, Vec4 color, const std::string &value);
    bool button(float x, float y, float width, float height, const std::string &label,
                bool active = false);
    void line(float x, float y, float width, Vec4 color);

private:
    struct Vertex {
        float x;
        float y;
        float u;
        float v;
        float r;
        float g;
        float b;
        float a;
    };

    void addQuad(float x, float y, float width, float height, float u0, float v0,
                 float u1, float v1, Vec4 color);

    gl::GLuint shader_ = 0;
    gl::GLuint vao_ = 0;
    gl::GLuint vbo_ = 0;
    Font *font_ = nullptr;
    std::vector<Vertex> vertices_;
    int width_ = 1;
    int height_ = 1;
    const InputState *input_ = nullptr;
    gl::GLint viewportLocation_ = -1;
};

}  // namespace oit
