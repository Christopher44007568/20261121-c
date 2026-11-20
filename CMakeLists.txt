cmake_minimum_required(VERSION 3.16)
project(depth_viewer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Local Vulkan SDK prefix (headers + loader) lives outside the repo.
set(VK_LOCAL_PREFIX "/home/hj/local/usr" CACHE PATH "Local Vulkan SDK prefix")
find_program(GLSLC glslc HINTS "${VK_LOCAL_PREFIX}/bin" REQUIRED)

set(SHADER_DIR ${CMAKE_CURRENT_SOURCE_DIR}/shaders)
set(SPV_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv)
file(MAKE_DIRECTORY ${SPV_DIR})

set(SHADERS depth.vert depth.frag)
set(SPV_FILES "")
foreach(S ${SHADERS})
  set(SPV ${SPV_DIR}/${S}.spv)
  add_custom_command(
    OUTPUT ${SPV}
    COMMAND ${CMAKE_COMMAND} -E env
      "LD_LIBRARY_PATH=${VK_LOCAL_PREFIX}/lib/x86_64-linux-gnu"
      ${GLSLC} -O -o ${SPV} ${SHADER_DIR}/${S}
    DEPENDS ${SHADER_DIR}/${S}
    COMMENT "glslc ${S}")
  list(APPEND SPV_FILES ${SPV})
endforeach()
add_custom_target(shaders ALL DEPENDS ${SPV_FILES})

add_executable(depth_viewer src/main.cpp)
add_dependencies(depth_viewer shaders)
target_include_directories(depth_viewer PRIVATE ${VK_LOCAL_PREFIX}/include)
target_link_directories(depth_viewer PRIVATE ${VK_LOCAL_PREFIX}/lib/x86_64-linux-gnu)
target_link_libraries(depth_viewer PRIVATE vulkan)
target_compile_definitions(depth_viewer PRIVATE SPV_DIR="${SPV_DIR}")
set_target_properties(depth_viewer PROPERTIES
  BUILD_RPATH "${VK_LOCAL_PREFIX}/lib/x86_64-linux-gnu")
