#pragma once

#include <array>
#include <string>

namespace oit {

enum class Key : int {
    Escape,
    P,
    O,
    R,
    Space,
    Tab,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    F1,
    F2,
    Count,
};

struct InputState {
    std::array<bool, static_cast<int>(Key::Count)> pressed{};
    float mouseX = 0.0f;
    float mouseY = 0.0f;
    bool mouseDown = false;
    bool mousePressed = false;
    bool mouseReleased = false;
    bool dragging = false;
    float dragX = 0.0f;
    float dragY = 0.0f;
    float scroll = 0.0f;
};

class Platform {
public:
    Platform();
    ~Platform();

    bool createWindow(int width, int height, const std::string &title, std::string *error);
    bool createHeadless(int width, int height, std::string *error);
    void pollEvents();
    void swapBuffers();
    void close();

    int width() const { return width_; }
    int height() const { return height_; }
    bool resized() const { return resized_; }
    void clearResized() { resized_ = false; }
    bool shouldClose() const { return shouldClose_; }
    const InputState &input() const { return input_; }
    double timeSeconds() const;

    const std::string &rendererName() const { return rendererName_; }
    const std::string &glVersion() const { return glVersion_; }

private:
    bool finishContext(std::string *error);
    void mapKey(int keySym);
    void resetMouseState();

    int width_ = 0;
    int height_ = 0;
    bool resized_ = false;
    bool shouldClose_ = false;
    bool headless_ = false;
    InputState input_{};
    std::string rendererName_;
    std::string glVersion_;
    double startTime_ = 0.0;

    void *x11Lib_ = nullptr;
    void *glLib_ = nullptr;
    void *eglLib_ = nullptr;
    void *display_ = nullptr;
    unsigned long window_ = 0;
    void *glContext_ = nullptr;
    void *eglDisplay_ = nullptr;
    void *eglSurface_ = nullptr;
    unsigned long deleteAtom_ = 0;

    void *x11Api_ = nullptr;
    void *glxApi_ = nullptr;
    void *eglApi_ = nullptr;
};

}  // namespace oit
