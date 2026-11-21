cmake_minimum_required(VERSION 3.20)
project(stencil_shadow_volume LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(shadowdemo
    src/main.cpp
    src/mesh.cpp
    src/render.cpp
    src/validation.cpp
    src/png.cpp
)

target_include_directories(shadowdemo PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_compile_definitions(shadowdemo PRIVATE
    SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders"
)

target_compile_options(shadowdemo PRIVATE -O2 -Wall -Wextra -Wpedantic)

# The evaluation image has EGL/OpenGL and zlib runtime libraries but not their
# unversioned development symlinks. GNU ld can link the runtime SONAMEs directly.
target_link_libraries(shadowdemo PRIVATE
    "-l:libepoxy.so.0"
    "-l:libz.so.1"
)

add_custom_command(TARGET shadowdemo POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_SOURCE_DIR}/artifacts/images
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_SOURCE_DIR}/artifacts/verify
)

