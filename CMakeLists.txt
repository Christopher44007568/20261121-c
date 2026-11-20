cmake_minimum_required(VERSION 3.16)
project(lidar_scan_prototype CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(EMBREE_ROOT ${CMAKE_SOURCE_DIR}/third_party/embree)

add_executable(scanner src/scanner.cpp)
target_include_directories(scanner PRIVATE ${EMBREE_ROOT}/include)
target_link_directories(scanner PRIVATE ${EMBREE_ROOT}/lib)
target_link_libraries(scanner PRIVATE embree4)
set_target_properties(scanner PROPERTIES
    BUILD_RPATH "${EMBREE_ROOT}/lib"
    INSTALL_RPATH "${EMBREE_ROOT}/lib")
