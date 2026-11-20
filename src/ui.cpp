#include "ui.hpp"

#include <algorithm>
#include <cstddef>
#include <vector>

namespace oit {

namespace {

const char *kUiVertexShader = R"GLSL(
#version 430 core
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;
layout(location = 2) in vec4 aColor;
uniform vec2 uViewport;
out vec2 vTexCoord;
out vec4 vColor;
void main() {
    vec2 ndc = vec2(aPosition.x / uViewport.x * 2.0 - 1.0,
                    1.0 - aPosition.y / uViewport.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    vTexCoord = aTexCoord;
    vColor = aColor;
}
)GLSL";

const char *kUiFragmentShader = R"GLSL(
#version 430 core
in vec2 vTexCoord;
in vec4 vColor;
uniform sampler2D uFont;
out vec4 fragColor;
void main() {
    if (vTexCoord.x >= 0.0) {
        float coverage = texture(uFont, vTexCoord).a;
        if (coverage < 0.5) discard;
    }
    fragColor = vColor;
}
)GLSL";

gl::GLuint compileShader(gl::GLenum type, const char *source, std::string *error) {
    const gl::GLuint shader = gl::CreateShader(type);
    gl::ShaderSource(shader, 1, &source, nullptr);
    gl::CompileShader(shader);
    gl::GLint ok = 0;
    gl::GetShaderiv(shader, gl::GL_COMPILE_STATUS, &ok);
    if (!ok) {
        gl::GLint logLength = 0;
        gl::GetShaderiv(shader, gl::GL_INFO_LOG_LENGTH, &logLength);
        std::vector<char> log(static_cast<std::size_t>(std::max(1, logLength)));
        gl::GetShaderInfoLog(shader, static_cast<gl::GLsizei>(log.size()), nullptr, log.data());
        if (error) *error = std::string("UI shader compile failed: ") + log.data();
        gl::DeleteShader(shader);
        return 0;
    }
    return shader;
}

}  // namespace

bool Ui::create(Font *font, std::string *error) {
    font_ = font;
    if (!font_ || !font_->create()) {
        if (error) *error = "Could not create the UI font";
        return false;
    }
    const gl::GLuint vs = compileShader(gl::GL_VERTEX_SHADER, kUiVertexShader, error);
    if (!vs) return false;
    const gl::GLuint fs = compileShader(gl::GL_FRAGMENT_SHADER, kUiFragmentShader, error);
    if (!fs) {
        gl::DeleteShader(vs);
        return false;
    }
    shader_ = gl::CreateProgram();
    gl::AttachShader(shader_, vs);
    gl::AttachShader(shader_, fs);
    gl::LinkProgram(shader_);
    gl::DeleteShader(vs);
    gl::DeleteShader(fs);
    gl::GLint linked = 0;
    gl::GetProgramiv(shader_, gl::GL_LINK_STATUS, &linked);
    if (!linked) {
        gl::GLint logLength = 0;
        gl::GetProgramiv(shader_, gl::GL_INFO_LOG_LENGTH, &logLength);
        std::vector<char> log(static_cast<std::size_t>(std::max(1, logLength)));
        gl::GetProgramInfoLog(shader_, static_cast<gl::GLsizei>(log.size()), nullptr, log.data());
        if (error) *error = std::string("UI program link failed: ") + log.data();
        return false;
    }
    viewportLocation_ = gl::GetUniformLocation(shader_, "uViewport");
    const gl::GLint fontLocation = gl::GetUniformLocation(shader_, "uFont");

    gl::GenVertexArrays(1, &vao_);
    gl::GenBuffers(1, &vbo_);
    gl::BindVertexArray(vao_);
    gl::BindBuffer(gl::GL_ARRAY_BUFFER, vbo_);
    const gl::GLsizei stride = static_cast<gl::GLsizei>(sizeof(Vertex));
    gl::EnableVertexAttribArray(0);
    gl::VertexAttribPointer(0, 2, gl::GL_FLOAT, gl::GL_FALSE, stride,
                            reinterpret_cast<const void *>(offsetof(Vertex, x)));
    gl::EnableVertexAttribArray(1);
    gl::VertexAttribPointer(1, 2, gl::GL_FLOAT, gl::GL_FALSE, stride,
                            reinterpret_cast<const void *>(offsetof(Vertex, u)));
    gl::EnableVertexAttribArray(2);
    gl::VertexAttribPointer(2, 4, gl::GL_FLOAT, gl::GL_FALSE, stride,
                            reinterpret_cast<const void *>(offsetof(Vertex, r)));
    gl::BindVertexArray(0);
    gl::UseProgram(shader_);
    gl::Uniform1i(fontLocation, 0);
    return true;
}

void Ui::begin(int width, int height, const InputState &input) {
    width_ = std::max(1, width);
    height_ = std::max(1, height);
    input_ = &input;
    vertices_.clear();
}

void Ui::addQuad(float x, float y, float width, float height, float u0, float v0,
                 float u1, float v1, Vec4 color) {
    const Vertex a{x, y, u0, v0, color.x, color.y, color.z, color.w};
    const Vertex b{x + width, y, u1, v0, color.x, color.y, color.z, color.w};
    const Vertex c{x + width, y + height, u1, v1, color.x, color.y, color.z, color.w};
    const Vertex d{x, y + height, u0, v1, color.x, color.y, color.z, color.w};
    vertices_.push_back(a);
    vertices_.push_back(b);
    vertices_.push_back(c);
    vertices_.push_back(a);
    vertices_.push_back(c);
    vertices_.push_back(d);
}

void Ui::rect(float x, float y, float width, float height, Vec4 color) {
    addQuad(x, y, width, height, -1.0f, -1.0f, -1.0f, -1.0f, color);
}

void Ui::line(float x, float y, float width, Vec4 color) {
    rect(x, y, width, 1.0f, color);
}

void Ui::text(float x, float y, float scale, Vec4 color, const std::string &value) {
    float cursor = x;
    for (char c : value) {
        const int index = font_->glyphIndex(c);
        const int col = index % 16;
        const int row = index / 16;
        const float u0 = static_cast<float>(col * 8) / 128.0f;
        const float v0 = static_cast<float>(row * 8) / 64.0f;
        const float u1 = static_cast<float>(col * 8 + 8) / 128.0f;
        const float v1 = static_cast<float>(row * 8 + 8) / 64.0f;
        addQuad(cursor, y, 8.0f * scale, 8.0f * scale, u0, v0, u1, v1, color);
        cursor += 6.0f * scale;
    }
}

bool Ui::button(float x, float y, float width, float height, const std::string &label,
                bool active) {
    bool hovered = false;
    if (input_) {
        hovered = input_->mouseX >= x && input_->mouseX <= x + width &&
                  input_->mouseY >= y && input_->mouseY <= y + height;
    }
    Vec4 fill = active ? Vec4{0.12f, 0.40f, 0.54f, 0.96f}
                       : Vec4{0.10f, 0.14f, 0.18f, 0.94f};
    if (hovered) fill = active ? Vec4{0.16f, 0.51f, 0.67f, 1.0f}
                               : Vec4{0.18f, 0.24f, 0.29f, 0.98f};
    rect(x, y, width, height, fill);
    line(x, y + height - 1.0f, width, Vec4{0.30f, 0.42f, 0.50f, 0.75f});
    const float scale = 2.0f;
    const float textX = x + 9.0f;
    const float textY = y + (height - 7.0f * scale) * 0.5f;
    text(textX, textY, scale, Vec4{0.92f, 0.96f, 0.98f, 1.0f}, label);
    return hovered && input_ && input_->mousePressed;
}

void Ui::end() {
    if (vertices_.empty()) return;
    gl::Disable(gl::GL_DEPTH_TEST);
    gl::Disable(gl::GL_CULL_FACE);
    gl::Enable(gl::GL_BLEND);
    gl::BlendEquation(gl::GL_FUNC_ADD);
    gl::BlendFuncSeparate(gl::GL_SRC_ALPHA, gl::GL_ONE_MINUS_SRC_ALPHA, gl::GL_ONE,
                          gl::GL_ONE_MINUS_SRC_ALPHA);
    gl::UseProgram(shader_);
    gl::Uniform2f(viewportLocation_, static_cast<float>(width_), static_cast<float>(height_));
    gl::ActiveTexture(gl::GL_TEXTURE0);
    gl::BindTexture(gl::GL_TEXTURE_2D, font_->texture());
    gl::BindVertexArray(vao_);
    gl::BindBuffer(gl::GL_ARRAY_BUFFER, vbo_);
    gl::BufferData(gl::GL_ARRAY_BUFFER,
                   static_cast<gl::GLsizeiptr>(vertices_.size() * sizeof(Vertex)),
                   vertices_.data(), gl::GL_DYNAMIC_DRAW);
    gl::DrawArrays(gl::GL_TRIANGLES, 0, static_cast<gl::GLsizei>(vertices_.size()));
    gl::BindVertexArray(0);
}

}  // namespace oit
