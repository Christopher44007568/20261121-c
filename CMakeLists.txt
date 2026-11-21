cmake_minimum_required(VERSION 3.16)
project(DynamicResTaau LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(BUILD_SIM "Build the portable CPU validation harness" ON)

if(WIN32)
    add_executable(DynamicResTaau WIN32
        src/renderer/main.cpp
        src/renderer/dx11_context.cpp
        src/renderer/pbr_renderer.cpp
        src/renderer/temporal_upscaler.cpp
        src/renderer/gpu_timer.cpp
        src/renderer/scene.cpp
    )
    target_include_directories(DynamicResTaau PRIVATE src/renderer)
    target_link_libraries(DynamicResTaau PRIVATE d3d11 dxgi d3dcompiler dxguid)
    target_compile_definitions(DynamicResTaau PRIVATE UNICODE _UNICODE)
endif()

if(BUILD_SIM)
    add_executable(sim_bench src/sim/sim_main.cpp)
    target_include_directories(sim_bench PRIVATE
        src/sim ${CMAKE_CURRENT_SOURCE_DIR}/src/renderer/shaders)
    if(MSVC)
        target_compile_options(sim_bench PRIVATE /W4)
    else()
        target_compile_options(sim_bench PRIVATE -Wall -Wextra)
    endif()
endif()
