cmake_minimum_required(VERSION 3.16)
project(HairA2CDemo CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(HairA2CDemo WIN32
    src/main.cpp
    src/d3d.cpp
    src/scene.cpp
    src/render.cpp
    src/geometry.cpp
)

if(MSVC)
    target_compile_options(HairA2CDemo PRIVATE /utf-8 /W3)
else()
    target_compile_options(HairA2CDemo PRIVATE -Wall -finput-charset=UTF-8)
    target_link_options(HairA2CDemo PRIVATE -municode)
endif()

target_link_libraries(HairA2CDemo PRIVATE
    d3d11 dxgi d2d1 dwrite dxguid windowscodecs)

set_target_properties(HairA2CDemo PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/artifacts)
