#include "glmin.h"

#define GLFUN_DEFINE(ret, name, ...) ret (*name)(__VA_ARGS__) = nullptr;
GLFUN_LIST(GLFUN_DEFINE)
#undef GLFUN_DEFINE

bool glmin_load() {
  bool ok = true;
#define GLFUN_LOAD(ret, name, ...)                                        \
  name = reinterpret_cast<ret (*)(__VA_ARGS__)>(eglGetProcAddress(#name)); \
  if (!name) ok = false;
  GLFUN_LIST(GLFUN_LOAD)
#undef GLFUN_LOAD
  return ok;
}
