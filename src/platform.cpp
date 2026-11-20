#include "platform.hpp"

#include "gl_api.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <dlfcn.h>

namespace oit {
namespace {

using XDisplay = struct _XDisplay;
using XWindow = unsigned long;
using XColormap = unsigned long;
using XAtom = unsigned long;
using XVisual = struct _XVisual;
using XKeySym = unsigned long;

struct XVisualInfo {
    XVisual *visual;
    unsigned long visualid;
    int screen;
    int depth;
    int c_class;
    unsigned long red_mask;
    unsigned long green_mask;
    unsigned long blue_mask;
    int colormap_size;
    int bits_per_rgb;
};

struct XSetWindowAttributes {
    unsigned long background_pixmap;
    unsigned long background_pixel;
    unsigned long border_pixmap;
    unsigned long border_pixel;
    int bit_gravity;
    int win_gravity;
    int backing_store;
    unsigned long backing_planes;
    unsigned long backing_pixel;
    int save_under;
    long event_mask;
    long do_not_propagate_mask;
    int override_redirect;
    XColormap colormap;
    unsigned long cursor;
};

struct XAnyEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow window;
};

struct XKeyEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow window;
    XWindow root;
    XWindow subwindow;
    unsigned long time;
    int x;
    int y;
    int x_root;
    int y_root;
    unsigned int state;
    unsigned int keycode;
    int same_screen;
};

struct XButtonEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow window;
    XWindow root;
    XWindow subwindow;
    unsigned long time;
    int x;
    int y;
    int x_root;
    int y_root;
    unsigned int state;
    unsigned int button;
    int same_screen;
};

struct XMotionEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow window;
    XWindow root;
    XWindow subwindow;
    unsigned long time;
    int x;
    int y;
    int x_root;
    int y_root;
    unsigned int state;
    char is_hint;
    int same_screen;
};

struct XConfigureEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow event;
    XWindow window;
    int x;
    int y;
    int width;
    int height;
    int border_width;
    XWindow above;
    int override_redirect;
};

struct XClientMessageEvent {
    int type;
    unsigned long serial;
    int send_event;
    void *display;
    XWindow window;
    XAtom message_type;
    int format;
    union {
        char b[20];
        short s[10];
        long l[5];
    } data;
};

union XEvent {
    int type;
    XAnyEvent xany;
    XKeyEvent xkey;
    XButtonEvent xbutton;
    XMotionEvent xmotion;
    XConfigureEvent xconfigure;
    XClientMessageEvent xclient;
    long pad[24];
};

struct X11Api {
    XDisplay *(*OpenDisplay)(const char *) = nullptr;
    int (*DefaultScreen)(XDisplay *) = nullptr;
    XWindow (*RootWindow)(XDisplay *, int) = nullptr;
    XColormap (*CreateColormap)(XDisplay *, XWindow, XVisual *, int) = nullptr;
    XWindow (*CreateWindow)(XDisplay *, XWindow, int, int, unsigned int, unsigned int,
                            unsigned int, int, unsigned int, XVisual *, unsigned long,
                            XSetWindowAttributes *) = nullptr;
    int (*StoreName)(XDisplay *, XWindow, const char *) = nullptr;
    int (*MapWindow)(XDisplay *, XWindow) = nullptr;
    int (*SelectInput)(XDisplay *, XWindow, long) = nullptr;
    int (*Pending)(XDisplay *) = nullptr;
    int (*NextEvent)(XDisplay *, XEvent *) = nullptr;
    int (*Flush)(XDisplay *) = nullptr;
    int (*DestroyWindow)(XDisplay *, XWindow) = nullptr;
    int (*CloseDisplay)(XDisplay *) = nullptr;
    int (*Free)(void *) = nullptr;
    XAtom (*InternAtom)(XDisplay *, const char *, int) = nullptr;
    int (*SetWMProtocols)(XDisplay *, XWindow, XAtom *, int) = nullptr;
    XKeySym (*LookupKeysym)(XKeyEvent *, int) = nullptr;
    int (*QueryPointer)(XDisplay *, XWindow, XWindow *, XWindow *, int *, int *, int *, int *,
                        unsigned int *) = nullptr;

    bool load(void *lib, std::string *error) {
#define OIT_LOAD_X(field, symbol) \
    do { \
        field = reinterpret_cast<decltype(field)>(dlsym(lib, symbol)); \
        if (!field) { \
            if (error) *error = std::string("Missing X11 symbol: ") + symbol; \
            return false; \
        } \
    } while (false)
        OIT_LOAD_X(OpenDisplay, "XOpenDisplay");
        OIT_LOAD_X(DefaultScreen, "XDefaultScreen");
        OIT_LOAD_X(RootWindow, "XRootWindow");
        OIT_LOAD_X(CreateColormap, "XCreateColormap");
        OIT_LOAD_X(CreateWindow, "XCreateWindow");
        OIT_LOAD_X(StoreName, "XStoreName");
        OIT_LOAD_X(MapWindow, "XMapWindow");
        OIT_LOAD_X(SelectInput, "XSelectInput");
        OIT_LOAD_X(Pending, "XPending");
        OIT_LOAD_X(NextEvent, "XNextEvent");
        OIT_LOAD_X(Flush, "XFlush");
        OIT_LOAD_X(DestroyWindow, "XDestroyWindow");
        OIT_LOAD_X(CloseDisplay, "XCloseDisplay");
        OIT_LOAD_X(Free, "XFree");
        OIT_LOAD_X(InternAtom, "XInternAtom");
        OIT_LOAD_X(SetWMProtocols, "XSetWMProtocols");
        OIT_LOAD_X(LookupKeysym, "XLookupKeysym");
        OIT_LOAD_X(QueryPointer, "XQueryPointer");
#undef OIT_LOAD_X
        return true;
    }
};

struct GlxApi {
    XVisualInfo *(*ChooseVisual)(XDisplay *, int, int *) = nullptr;
    void *(*CreateContext)(XDisplay *, XVisualInfo *, void *, int) = nullptr;
    int (*MakeCurrent)(XDisplay *, XWindow, void *) = nullptr;
    void (*SwapBuffers)(XDisplay *, XWindow) = nullptr;
    void *(*GetProcAddress)(const unsigned char *) = nullptr;
    int (*DestroyContext)(XDisplay *, void *) = nullptr;
    int (*QueryVersion)(XDisplay *, int *, int *) = nullptr;

    bool load(void *lib, std::string *error) {
#define OIT_LOAD_GLX(field, symbol) \
    do { \
        field = reinterpret_cast<decltype(field)>(dlsym(lib, symbol)); \
        if (!field) { \
            if (error) *error = std::string("Missing GLX symbol: ") + symbol; \
            return false; \
        } \
    } while (false)
        OIT_LOAD_GLX(ChooseVisual, "glXChooseVisual");
        OIT_LOAD_GLX(CreateContext, "glXCreateContext");
        OIT_LOAD_GLX(MakeCurrent, "glXMakeCurrent");
        OIT_LOAD_GLX(SwapBuffers, "glXSwapBuffers");
        OIT_LOAD_GLX(GetProcAddress, "glXGetProcAddressARB");
        OIT_LOAD_GLX(DestroyContext, "glXDestroyContext");
        OIT_LOAD_GLX(QueryVersion, "glXQueryVersion");
#undef OIT_LOAD_GLX
        return true;
    }
};

constexpr int kGlxRgba = 4;
constexpr int kGlxDoublebuffer = 5;
constexpr int kGlxRedSize = 8;
constexpr int kGlxGreenSize = 9;
constexpr int kGlxBlueSize = 10;
constexpr int kGlxAlphaSize = 11;
constexpr int kGlxDepthSize = 12;
constexpr int kGlxNone = 0x8000;
constexpr unsigned long kCwColormap = 1u << 13;
constexpr unsigned long kCwEventMask = 1u << 11;
constexpr long kKeyPressMask = 1L << 0;
constexpr long kKeyReleaseMask = 1L << 1;
constexpr long kButtonPressMask = 1L << 2;
constexpr long kButtonReleaseMask = 1L << 3;
constexpr long kPointerMotionMask = 1L << 6;
constexpr long kExposureMask = 1L << 15;
constexpr long kStructureNotifyMask = 1L << 17;
constexpr int kKeyPress = 2;
constexpr int kKeyRelease = 3;
constexpr int kButtonPress = 4;
constexpr int kButtonRelease = 5;
constexpr int kMotionNotify = 6;
constexpr int kConfigureNotify = 22;
constexpr int kClientMessage = 33;

GlxApi *s_glxResolver = nullptr;

void *glProcForGlx(const char *name) {
    auto *api = static_cast<GlxApi *>(s_glxResolver);
    return api ? api->GetProcAddress(reinterpret_cast<const unsigned char *>(name)) : nullptr;
}

using EglDisplay = void *;
using EglConfig = void *;
using EglSurface = void *;
using EglContext = void *;

struct EglApi {
    EglDisplay (*GetDisplay)(void *) = nullptr;
    EglDisplay (*GetPlatformDisplayEXT)(unsigned int, void *, const int *) = nullptr;
    int (*Initialize)(EglDisplay, int *, int *) = nullptr;
    int (*BindAPI)(unsigned int) = nullptr;
    int (*ChooseConfig)(EglDisplay, const int *, EglConfig *, int, int *) = nullptr;
    EglSurface (*CreatePbufferSurface)(EglDisplay, EglConfig, const int *) = nullptr;
    EglContext (*CreateContext)(EglDisplay, EglConfig, EglContext, const int *) = nullptr;
    int (*MakeCurrent)(EglDisplay, EglSurface, EglSurface, EglContext) = nullptr;
    int (*DestroySurface)(EglDisplay, EglSurface) = nullptr;
    int (*DestroyContext)(EglDisplay, EglContext) = nullptr;
    int (*Terminate)(EglDisplay) = nullptr;
    void *(*GetProcAddress)(const char *) = nullptr;
    const char *(*QueryString)(EglDisplay, int) = nullptr;

    bool load(void *lib, std::string *error) {
#define OIT_LOAD_EGL(field, symbol) \
    do { \
        field = reinterpret_cast<decltype(field)>(dlsym(lib, symbol)); \
        if (!field) { \
            if (error) *error = std::string("Missing EGL symbol: ") + symbol; \
            return false; \
        } \
    } while (false)
        OIT_LOAD_EGL(GetDisplay, "eglGetDisplay");
        OIT_LOAD_EGL(Initialize, "eglInitialize");
        OIT_LOAD_EGL(BindAPI, "eglBindAPI");
        OIT_LOAD_EGL(ChooseConfig, "eglChooseConfig");
        OIT_LOAD_EGL(CreatePbufferSurface, "eglCreatePbufferSurface");
        OIT_LOAD_EGL(CreateContext, "eglCreateContext");
        OIT_LOAD_EGL(MakeCurrent, "eglMakeCurrent");
        OIT_LOAD_EGL(DestroySurface, "eglDestroySurface");
        OIT_LOAD_EGL(DestroyContext, "eglDestroyContext");
        OIT_LOAD_EGL(Terminate, "eglTerminate");
        OIT_LOAD_EGL(GetProcAddress, "eglGetProcAddress");
        OIT_LOAD_EGL(QueryString, "eglQueryString");
#undef OIT_LOAD_EGL
        GetPlatformDisplayEXT = reinterpret_cast<decltype(GetPlatformDisplayEXT)>(
            dlsym(lib, "eglGetPlatformDisplayEXT"));
        return true;
    }
};

constexpr int kEglSurfaceType = 0x3033;
constexpr int kEglPbufferBit = 0x0001;
constexpr int kEglRenderableType = 0x3040;
constexpr int kEglOpenGLBit = 0x0008;
constexpr int kEglRedSize = 0x3024;
constexpr int kEglGreenSize = 0x3025;
constexpr int kEglBlueSize = 0x3026;
constexpr int kEglAlphaSize = 0x3027;
constexpr int kEglDepthSize = 0x3025 + 3;
constexpr int kEglNone = 0x3038;
constexpr int kEglWidth = 0x3057;
constexpr int kEglHeight = 0x3056;
constexpr unsigned int kEglOpenGLAPI = 0x30A2;
constexpr int kEglContextMajor = 0x3098;
constexpr int kEglContextMinor = 0x30FB;
constexpr int kEglContextProfileMask = 0x30FD;
constexpr int kEglContextCoreProfile = 0x0001;
constexpr unsigned int kEglPlatformSurfacelessMesa = 0x31DD;

EglApi *s_eglResolver = nullptr;
void *s_eglGlLib = nullptr;

void *glProcForEgl(const char *name) {
    void *address = s_eglResolver ? s_eglResolver->GetProcAddress(name) : nullptr;
    if (!address && s_eglGlLib) address = dlsym(s_eglGlLib, name);
    return address;
}

bool xKeySymToKey(XKeySym sym, Key *key) {
    if (sym == 0xff1b) {
        *key = Key::Escape;
        return true;
    }
    if (sym == 0xff09) {
        *key = Key::Tab;
        return true;
    }
    if (sym == 0x20) {
        *key = Key::Space;
        return true;
    }
    if (sym == 0xffbe) {
        *key = Key::F1;
        return true;
    }
    if (sym == 0xffbf) {
        *key = Key::F2;
        return true;
    }
    if (sym >= '1' && sym <= '4') {
        *key = static_cast<Key>(static_cast<int>(Key::Digit1) + static_cast<int>(sym - '1'));
        return true;
    }
    if (sym >= 'A' && sym <= 'Z') sym += 'a' - 'A';
    if (sym == 'p') {
        *key = Key::P;
        return true;
    }
    if (sym == 'o') {
        *key = Key::O;
        return true;
    }
    if (sym == 'r') {
        *key = Key::R;
        return true;
    }
    return false;
}

}  // namespace

Platform::Platform() {
    startTime_ = timeSeconds();
}

Platform::~Platform() {
    close();
}

bool Platform::createWindow(int width, int height, const std::string &title, std::string *error) {
    close();
    headless_ = false;
    width_ = width;
    height_ = height;

    x11Lib_ = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
    if (!x11Lib_) {
        if (error) *error = "Could not load libX11.so.6";
        return false;
    }
    auto *x11 = new X11Api;
    if (!x11->load(x11Lib_, error)) {
        delete x11;
        return false;
    }
    x11Api_ = x11;

    glLib_ = dlopen("libGL.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!glLib_) {
        if (error) *error = "Could not load libGL.so.1";
        return false;
    }
    auto *glx = new GlxApi;
    if (!glx->load(glLib_, error)) {
        delete glx;
        return false;
    }
    glxApi_ = glx;

    display_ = x11->OpenDisplay(nullptr);
    if (!display_) {
        if (error) *error = "No X11 display (set DISPLAY or use --headless)";
        return false;
    }
    auto *display = static_cast<XDisplay *>(display_);
    const int screen = x11->DefaultScreen(display);
    const XWindow root = x11->RootWindow(display, screen);
    int visualAttribs[] = {
        kGlxRgba, kGlxDoublebuffer,
        kGlxRedSize, 8, kGlxGreenSize, 8, kGlxBlueSize, 8, kGlxAlphaSize, 8,
        kGlxDepthSize, 24,
        kGlxNone,
    };
    XVisualInfo *visual = glx->ChooseVisual(display, screen, visualAttribs);
    if (!visual) {
        if (error) *error = "No suitable GLX visual";
        return false;
    }

    XSetWindowAttributes attributes{};
    attributes.colormap = x11->CreateColormap(display, root, visual->visual, 0);
    attributes.event_mask = kKeyPressMask | kKeyReleaseMask | kButtonPressMask |
                            kButtonReleaseMask | kPointerMotionMask | kExposureMask |
                            kStructureNotifyMask;
    window_ = x11->CreateWindow(display, root, 0, 0, static_cast<unsigned int>(width),
                                static_cast<unsigned int>(height), 0, visual->depth, 1,
                                visual->visual, kCwColormap | kCwEventMask, &attributes);
    x11->StoreName(display, window_, title.c_str());
    deleteAtom_ = x11->InternAtom(display, "WM_DELETE_WINDOW", 0);
    if (deleteAtom_) x11->SetWMProtocols(display, window_, &deleteAtom_, 1);
    x11->MapWindow(display, window_);
    x11->Flush(display);

    glContext_ = glx->CreateContext(display, visual, nullptr, 1);
    x11->Free(visual);
    if (!glContext_) {
        if (error) *error = "Could not create a GLX context";
        return false;
    }
    if (!glx->MakeCurrent(display, window_, glContext_)) {
        if (error) *error = "glXMakeCurrent failed";
        return false;
    }
    s_glxResolver = glx;
    glxApi_ = glx;
    x11Api_ = x11;
    return finishContext(error);
}

bool Platform::createHeadless(int width, int height, std::string *error) {
    close();
    headless_ = true;
    width_ = width;
    height_ = height;

    eglLib_ = dlopen("libEGL.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!eglLib_) {
        if (error) *error = "Could not load libEGL.so.1 for headless mode";
        return false;
    }
    auto *egl = new EglApi;
    if (!egl->load(eglLib_, error)) {
        delete egl;
        return false;
    }
    eglApi_ = egl;
    eglDisplay_ = egl->GetPlatformDisplayEXT
                      ? egl->GetPlatformDisplayEXT(kEglPlatformSurfacelessMesa, nullptr, nullptr)
                      : egl->GetDisplay(nullptr);
    if (!eglDisplay_ || !egl->Initialize(static_cast<EglDisplay>(eglDisplay_), nullptr, nullptr)) {
        if (error) *error = "Could not initialize an EGL display";
        return false;
    }
    if (!egl->BindAPI(kEglOpenGLAPI)) {
        if (error) *error = "EGL does not support the OpenGL API";
        return false;
    }
    const int configAttribs[] = {
        kEglSurfaceType, kEglPbufferBit,
        kEglRenderableType, kEglOpenGLBit,
        kEglNone,
    };
    EglConfig config = nullptr;
    int configCount = 0;
    if (!egl->ChooseConfig(static_cast<EglDisplay>(eglDisplay_), configAttribs, &config, 1,
                           &configCount) || configCount < 1) {
        if (error) *error = "No suitable headless EGL config";
        return false;
    }
    eglSurface_ = nullptr;
    const int contextAttribs[] = {
        kEglContextMajor, 4,
        kEglContextMinor, 3,
        kEglContextProfileMask, kEglContextCoreProfile,
        kEglNone,
    };
    glContext_ = egl->CreateContext(static_cast<EglDisplay>(eglDisplay_), config, nullptr,
                                    contextAttribs);
    if (!glContext_) {
        if (error) *error = "Could not create an OpenGL 4.3 EGL context";
        return false;
    }
    if (!egl->MakeCurrent(static_cast<EglDisplay>(eglDisplay_),
                          nullptr,
                          nullptr,
                          static_cast<EglContext>(glContext_))) {
        if (error) *error = "eglMakeCurrent failed";
        return false;
    }
    glLib_ = dlopen("libGL.so.1", RTLD_NOW | RTLD_LOCAL);
    s_eglGlLib = glLib_;
    s_eglResolver = egl;
    return finishContext(error);
}

bool Platform::finishContext(std::string *error) {
    if (!gl::load(headless_ ? glProcForEgl : glProcForGlx, error)) return false;
    const auto *version = gl::GetString(gl::GL_VERSION);
    const auto *renderer = gl::GetString(gl::GL_RENDERER);
    glVersion_ = version ? reinterpret_cast<const char *>(version) : "unknown";
    rendererName_ = renderer ? reinterpret_cast<const char *>(renderer) : "unknown";

    gl::GLint major = 0;
    gl::GLint minor = 0;
    gl::GetIntegerv(gl::GL_MAJOR_VERSION, &major);
    gl::GetIntegerv(gl::GL_MINOR_VERSION, &minor);
    if (major < 4 || (major == 4 && minor < 3)) {
        if (error) {
            *error = "OpenGL 4.3 is required (reported " + glVersion_ + ", " + rendererName_ + ")";
        }
        return false;
    }
    return true;
}

void Platform::resetMouseState() {
    input_.pressed.fill(false);
    input_.mousePressed = false;
    input_.mouseReleased = false;
    input_.scroll = 0.0f;
    input_.dragX = 0.0f;
    input_.dragY = 0.0f;
}

void Platform::mapKey(int keySym) {
    Key key{};
    if (!xKeySymToKey(static_cast<XKeySym>(keySym), &key)) return;
    input_.pressed[static_cast<int>(key)] = true;
}

void Platform::pollEvents() {
    resetMouseState();
    if (headless_) return;
    auto *x11 = static_cast<X11Api *>(x11Api_);
    auto *display = static_cast<XDisplay *>(display_);
    if (!x11 || !display) return;

    while (x11->Pending(display) > 0) {
        XEvent event{};
        x11->NextEvent(display, &event);
        if (event.type == kKeyPress) {
            const XKeySym sym = x11->LookupKeysym(&event.xkey, 0);
            mapKey(static_cast<int>(sym));
        } else if (event.type == kButtonPress) {
            if (event.xbutton.button == 1) {
                input_.mousePressed = !input_.mouseDown;
                input_.mouseDown = true;
                input_.dragging = true;
            } else if (event.xbutton.button == 4) {
                input_.scroll += 1.0f;
            } else if (event.xbutton.button == 5) {
                input_.scroll -= 1.0f;
            }
            input_.mouseX = static_cast<float>(event.xbutton.x);
            input_.mouseY = static_cast<float>(event.xbutton.y);
        } else if (event.type == kButtonRelease) {
            if (event.xbutton.button == 1) {
                input_.mouseDown = false;
                input_.mouseReleased = true;
                input_.dragging = false;
            }
        } else if (event.type == kMotionNotify) {
            const float x = static_cast<float>(event.xmotion.x);
            const float y = static_cast<float>(event.xmotion.y);
            if (input_.mouseDown) {
                input_.dragX += x - input_.mouseX;
                input_.dragY += y - input_.mouseY;
            }
            input_.mouseX = x;
            input_.mouseY = y;
        } else if (event.type == kConfigureNotify) {
            if (event.xconfigure.width > 0 && event.xconfigure.height > 0 &&
                (event.xconfigure.width != width_ || event.xconfigure.height != height_)) {
                width_ = event.xconfigure.width;
                height_ = event.xconfigure.height;
                resized_ = true;
            }
        } else if (event.type == kClientMessage &&
                   event.xclient.data.l[0] == static_cast<long>(deleteAtom_)) {
            shouldClose_ = true;
        }
    }

    XWindow root = 0;
    XWindow child = 0;
    int rootX = 0;
    int rootY = 0;
    int windowX = 0;
    int windowY = 0;
    unsigned int mask = 0;
    if (x11->QueryPointer(display, window_, &root, &child, &rootX, &rootY, &windowX,
                          &windowY, &mask)) {
        input_.mouseX = static_cast<float>(windowX);
        input_.mouseY = static_cast<float>(windowY);
        input_.mouseDown = (mask & (1u << 8)) != 0;
    }
}

void Platform::swapBuffers() {
    if (headless_ || !glxApi_ || !display_) return;
    auto *glx = static_cast<GlxApi *>(glxApi_);
    glx->SwapBuffers(static_cast<XDisplay *>(display_), window_);
}

void Platform::close() {
    if (headless_) {
        auto *egl = static_cast<EglApi *>(eglApi_);
        if (egl && eglDisplay_) {
            if (glContext_) {
                egl->MakeCurrent(static_cast<EglDisplay>(eglDisplay_), nullptr, nullptr, nullptr);
                egl->DestroyContext(static_cast<EglDisplay>(eglDisplay_),
                                    static_cast<EglContext>(glContext_));
            }
            if (eglSurface_) {
                egl->DestroySurface(static_cast<EglDisplay>(eglDisplay_),
                                    static_cast<EglSurface>(eglSurface_));
            }
            egl->Terminate(static_cast<EglDisplay>(eglDisplay_));
        }
        if (eglApi_) delete static_cast<EglApi *>(eglApi_);
        if (glLib_) dlclose(glLib_);
        if (eglLib_) dlclose(eglLib_);
    } else {
        auto *glx = static_cast<GlxApi *>(glxApi_);
        auto *x11 = static_cast<X11Api *>(x11Api_);
        auto *display = static_cast<XDisplay *>(display_);
        if (glx && display && glContext_) glx->DestroyContext(display, glContext_);
        if (x11 && display && window_) {
            x11->DestroyWindow(display, window_);
            x11->CloseDisplay(display);
        }
        if (glxApi_) delete static_cast<GlxApi *>(glxApi_);
        if (x11Api_) delete static_cast<X11Api *>(x11Api_);
        if (glLib_) dlclose(glLib_);
        if (x11Lib_) dlclose(x11Lib_);
    }
    s_glxResolver = nullptr;
    s_eglResolver = nullptr;
    s_eglGlLib = nullptr;
    x11Lib_ = glLib_ = eglLib_ = nullptr;
    x11Api_ = glxApi_ = eglApi_ = nullptr;
    display_ = nullptr;
    window_ = 0;
    glContext_ = nullptr;
    eglDisplay_ = nullptr;
    eglSurface_ = nullptr;
    deleteAtom_ = 0;
}

double Platform::timeSeconds() const {
    using Clock = std::chrono::steady_clock;
    static const auto epoch = Clock::now();
    return std::chrono::duration<double>(Clock::now() - epoch).count();
}
}  // namespace oit
