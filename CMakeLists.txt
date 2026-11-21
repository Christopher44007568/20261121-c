cmake_minimum_required(VERSION 3.16)
project(lmuv LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
add_compile_options(-Wall -Wextra -Wno-unused-parameter)

add_library(lmuv_core STATIC
  src/lmuv/json.cpp
  src/lmuv/mesh.cpp
  src/lmuv/island.cpp
  src/lmuv/unwrap.cpp
  src/lmuv/pack.cpp
  src/lmuv/verify.cpp
  src/lmuv/io.cpp
)
target_include_directories(lmuv_core PUBLIC src)

add_executable(lmuv src/main.cpp)
target_link_libraries(lmuv PRIVATE lmuv_core)
