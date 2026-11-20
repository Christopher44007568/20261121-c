cmake_minimum_required(VERSION 3.16)
project(oit_pipe_viewer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(oit_viewer
    src/main.cpp
    src/gl_api.cpp
    src/platform.cpp
    src/font.cpp
    src/ui.cpp
    src/renderer.cpp
)

target_include_directories(oit_viewer PRIVATE src)
target_compile_options(oit_viewer PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(oit_viewer PRIVATE dl)

target_compile_definitions(oit_viewer PRIVATE
    OIT_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders"
)

enable_testing()
add_executable(oit_math_test tests/math_test.cpp)
target_include_directories(oit_math_test PRIVATE src)
target_compile_options(oit_math_test PRIVATE -Wall -Wextra -Wpedantic)
add_test(NAME oit_math_test COMMAND oit_math_test)

add_test(NAME oit_headless_smoke
    COMMAND oit_viewer --headless --width 640 --height 360 --scene multi --view compare)
set_tests_properties(oit_headless_smoke PROPERTIES TIMEOUT 60)

add_test(NAME oit_benchmark_verify
    COMMAND oit_viewer --benchmark ${CMAKE_CURRENT_BINARY_DIR}/benchmark_verify --verify
            --width 800 --height 450)
set_tests_properties(oit_benchmark_verify PROPERTIES TIMEOUT 120)
