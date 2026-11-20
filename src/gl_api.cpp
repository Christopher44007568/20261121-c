#include "gl_api.hpp"

#include <string>

namespace oit::gl {

#define OIT_GL_DEFINE(ret, name, params) PFN_##name name = nullptr;
OIT_GL_FUNCTION_LIST(OIT_GL_DEFINE)
#undef OIT_GL_DEFINE

bool load(void *(*getProcAddress)(const char *name), std::string *error) {
    if (!getProcAddress) {
        if (error) *error = "No OpenGL proc-address resolver";
        return false;
    }

    std::string missing;
#define OIT_GL_LOAD(ret, fn, params) \
    do { \
        const std::string symbol = std::string("gl") + #fn; \
        void *address = getProcAddress(symbol.c_str()); \
        if (!address) { \
            if (!missing.empty()) missing += ", "; \
            missing += symbol; \
        } \
        fn = reinterpret_cast<PFN_##fn>(address); \
    } while (false);
    OIT_GL_FUNCTION_LIST(OIT_GL_LOAD)
#undef OIT_GL_LOAD

    if (!missing.empty()) {
        if (error) *error = "Missing OpenGL 4.3 entry points: " + missing;
        return false;
    }
    return true;
}

}  // namespace oit::gl
