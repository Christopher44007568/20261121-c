cmake_minimum_required(VERSION 3.16)
project(volview CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(volview
  src/main.cpp
  src/glmin.cpp
  src/gl_context.cpp
  src/volume.cpp
  src/transfer.cpp
  src/camera.cpp
  src/reference.cpp
  src/renderer.cpp
  src/regress.cpp
)
# No libEGL.so dev symlink in this environment: link the versioned library.
target_link_libraries(volview PRIVATE "-l:libEGL.so.1" dl)

add_executable(gl_smoke src/smoke_main.cpp src/glmin.cpp src/gl_context.cpp)
target_link_libraries(gl_smoke PRIVATE "-l:libEGL.so.1" dl)

add_executable(debug_ray
  src/debug_ray.cpp src/volume.cpp src/transfer.cpp src/camera.cpp
  src/reference.cpp)
