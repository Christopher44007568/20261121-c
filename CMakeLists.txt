cmake_minimum_required(VERSION 3.16)
project(anisotropic_material_ball LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Dependencies are expected under $VULKAN_SDK_LOCAL (see env.sh) when no
# system Vulkan SDK / GLFW is installed.
if(DEFINED ENV{VULKAN_SDK_LOCAL})
    set(SDK "$ENV{VULKAN_SDK_LOCAL}/usr")
    list(PREPEND CMAKE_PREFIX_PATH "${SDK}")
    include_directories(SYSTEM "${SDK}/include")
    link_directories("${SDK}/lib/x86_64-linux-gnu")
endif()

find_package(Vulkan REQUIRED)
find_package(glfw3 QUIET)

set(SHADER_DIR "${CMAKE_SOURCE_DIR}/shaders")
set(SHADER_OUT "${CMAKE_BINARY_DIR}/shaders")
file(MAKE_DIRECTORY "${SHADER_OUT}")

set(GLSL_SOURCES
    "${SHADER_DIR}/fabric.vert"
    "${SHADER_DIR}/fabric.frag")
set(SPIRV_OUTPUTS)
foreach(GLSL ${GLSL_SOURCES})
    get_filename_component(NAME "${GLSL}" NAME)
    set(OUT "${SHADER_OUT}/${NAME}.spv")
    list(APPEND SPIRV_OUTPUTS "${OUT}")
    add_custom_command(
        OUTPUT "${OUT}"
        COMMAND "${Vulkan_GLSLC_EXECUTABLE}" -fshader-stage=$<IF:$<STREQUAL:${NAME},fabric.vert>,vert,frag>
                "${GLSL}" -o "${OUT}"
        DEPENDS "${GLSL}"
        COMMENT "glslc ${NAME}")
endforeach()
add_custom_target(shaders ALL DEPENDS ${SPIRV_OUTPUTS})

add_executable(material_ball
    src/main.cpp
    src/vk_engine.cpp
    src/textures.cpp
    src/geometry.cpp
    src/measure.cpp)
add_dependencies(material_ball shaders)
target_include_directories(material_ball PRIVATE src)
target_link_libraries(material_ball PRIVATE Vulkan::Headers Vulkan::Vulkan)
if(glfw3_FOUND)
    target_link_libraries(material_ball PRIVATE glfw)
    target_compile_definitions(material_ball PRIVATE HAVE_GLFW=1)
endif()
target_compile_options(material_ball PRIVATE -Wall -Wextra -Wno-unused-parameter)
