cmake_minimum_required(VERSION 3.20)
project(Dx12SSR LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32)
    add_executable(Dx12SSR WIN32
        src/main.cpp
        src/SsrRenderer.cpp
    )
    target_include_directories(Dx12SSR PRIVATE src)
    target_link_libraries(Dx12SSR PRIVATE d3d12 dxgi d3dcompiler dxguid)
    source_group("Shaders" REGULAR_EXPRESSION "shaders/.*")
else()
    # On non-Windows hosts only the CPU reference simulator is buildable.
    message(STATUS "DX12 host requires Windows; building the CPU reference tool.")
    add_executable(ssr_ref reference/main.cpp)
    target_include_directories(ssr_ref PRIVATE reference)
    target_compile_options(ssr_ref PRIVATE -O2)
    add_executable(test_no_stale reference/test_no_stale.cpp)
    target_include_directories(test_no_stale PRIVATE reference)
endif()
