cmake_minimum_required(VERSION 3.16)
project(render_graph_vulkan LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(render_graph
    src/render_graph.cpp
    src/paths.cpp
    src/vulkan_runtime.cpp
)
target_include_directories(render_graph
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/vulkan/include
)
target_compile_definitions(render_graph PRIVATE
    RG_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders/spv"
)
target_link_libraries(render_graph PUBLIC ${CMAKE_DL_LIBS})

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(render_graph PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(render_graph_demo src/main.cpp)
target_link_libraries(render_graph_demo PRIVATE render_graph)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(render_graph_demo PRIVATE -Wall -Wextra -Wpedantic)
endif()

enable_testing()
add_executable(render_graph_tests tests/test_render_graph.cpp)
target_link_libraries(render_graph_tests PRIVATE render_graph)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(render_graph_tests PRIVATE -Wall -Wextra -Wpedantic)
endif()
add_test(NAME render_graph_tests COMMAND render_graph_tests)
