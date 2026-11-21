cmake_minimum_required(VERSION 3.21)

project(pcloud_viewer VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(PCLOUD_BUILD_GUI "Build the Qt/OpenGL viewer" ON)
option(PCLOUD_BUILD_TESTS "Build core tests" ON)

find_package(Threads REQUIRED)
find_package(Git QUIET)

add_library(pcloud_core STATIC
    src/core/BufferPool.cpp
    src/core/CameraPath.cpp
    src/core/ChunkReader.cpp
    src/core/FramePlanner.cpp
    src/core/Metrics.cpp
    src/core/SceneGenerator.cpp
    src/core/SceneIndex.cpp
    src/core/StressRunner.cpp
)

target_include_directories(pcloud_core PUBLIC src)
target_link_libraries(pcloud_core PUBLIC Threads::Threads)
target_compile_options(pcloud_core PRIVATE -Wall -Wextra -Wpedantic)

add_executable(pcloud_scene src/tools/scene_tool.cpp)
target_link_libraries(pcloud_scene PRIVATE pcloud_core)

add_executable(pcloud_stress src/tools/stress_tool.cpp)
target_link_libraries(pcloud_stress PRIVATE pcloud_core)

if(PCLOUD_BUILD_GUI)
    find_package(Qt6 6.2 QUIET COMPONENTS Core Gui Widgets OpenGL OpenGLWidgets)
endif()

if(PCLOUD_BUILD_GUI AND NOT Qt6_FOUND)
    message(WARNING
        "Qt6 6.2+ was not found; building core tools only. "
        "Install qt6-base-dev to build pcloud_viewer.")
    set(PCLOUD_BUILD_GUI OFF)
endif()

if(PCLOUD_BUILD_GUI)
    set(CMAKE_AUTOMOC ON)
    set(CMAKE_AUTORCC ON)

    add_library(pcloud_gui STATIC
        src/gui/MainWindow.cpp
        src/gui/PointCloudView.cpp
        src/gui/resources.qrc
    )
    target_include_directories(pcloud_gui PUBLIC src)
    target_link_libraries(pcloud_gui PUBLIC
        pcloud_core
        Qt6::Core
        Qt6::Gui
        Qt6::Widgets
        Qt6::OpenGL
        Qt6::OpenGLWidgets
    )
    target_compile_options(pcloud_gui PRIVATE -Wall -Wextra -Wpedantic)

    add_executable(pcloud_viewer src/app/main.cpp)
    target_link_libraries(pcloud_viewer PRIVATE pcloud_gui)
endif()

if(PCLOUD_BUILD_TESTS)
    enable_testing()
    add_executable(pcloud_core_tests tests/core_tests.cpp)
    target_link_libraries(pcloud_core_tests PRIVATE pcloud_core)
    target_compile_options(pcloud_core_tests PRIVATE -Wall -Wextra -Wpedantic)
    add_test(NAME pcloud_core_tests COMMAND pcloud_core_tests)
endif()
