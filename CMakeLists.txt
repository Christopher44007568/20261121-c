cmake_minimum_required(VERSION 3.21)

project(MicroSlice3D VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(microcore
    src/core/Geometry.h
    src/core/Volume.h
    src/core/Volume.cpp
    src/core/PlaneSampler.h
    src/core/PlaneSampler.cpp
    src/core/Phantom.h
    src/core/Phantom.cpp
    src/core/Calibration.h
    src/core/Calibration.cpp
)
target_include_directories(microcore PUBLIC src)

add_executable(calibration_report
    tools/calibration_report.cpp
)
target_link_libraries(calibration_report PRIVATE microcore)

find_package(OpenGL REQUIRED)
find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets)
qt_standard_project_setup()

include(CTest)
if(BUILD_TESTING)
    add_executable(core_tests tests/core_tests.cpp)
    target_link_libraries(core_tests PRIVATE microcore)
    add_test(NAME core_tests COMMAND core_tests)

    find_package(Qt6 REQUIRED COMPONENTS Test)
    qt_add_executable(gui_tests
        tests/gui_tests.cpp
        src/io/VolumeIO.h
        src/io/VolumeIO.cpp
        src/ui/MainWindow.h
        src/ui/MainWindow.cpp
        src/ui/SliceView.h
        src/ui/SliceView.cpp
        src/ui/OverviewView.h
        src/ui/OverviewView.cpp
    )
    target_link_libraries(gui_tests PRIVATE microcore Qt6::Widgets Qt6::Test)
    target_compile_definitions(gui_tests PRIVATE MICROSLICE_VERSION="${PROJECT_VERSION}")
    add_test(NAME gui_tests COMMAND gui_tests)
    set_tests_properties(gui_tests PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endif()

qt_add_executable(microslice3d
    src/main.cpp
    src/io/VolumeIO.h
    src/io/VolumeIO.cpp
    src/ui/MainWindow.h
    src/ui/MainWindow.cpp
    src/ui/SliceView.h
    src/ui/SliceView.cpp
    src/ui/OverviewView.h
    src/ui/OverviewView.cpp
)
target_link_libraries(microslice3d PRIVATE microcore Qt6::Widgets)
target_compile_definitions(microslice3d PRIVATE MICROSLICE_VERSION="${PROJECT_VERSION}")

install(TARGETS microslice3d RUNTIME DESTINATION bin)

