cmake_minimum_required(VERSION 3.16)
project(isopreview CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(isopreview
  src/main.cpp
  src/mesher.cpp
)
target_include_directories(isopreview PRIVATE src)
target_compile_options(isopreview PRIVATE -Wall -Wextra -O2)

enable_testing()
foreach(field blobs torus gyroid)
  foreach(iso 0.13 0.3 0.7)
    add_test(NAME verify_${field}_${iso}
             COMMAND isopreview --field ${field} --verify --iso ${iso} --grid 40)
  endforeach()
endforeach()
