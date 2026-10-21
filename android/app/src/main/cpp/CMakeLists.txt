cmake_minimum_required(VERSION 3.22)
project(tsnative C CXX)

# whisper.cpp wird im Build nach android/third_party/whisper.cpp geholt (siehe Workflow)
set(WHISPER_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/whisper.cpp)
if (NOT EXISTS ${WHISPER_DIR}/CMakeLists.txt)
    message(FATAL_ERROR "whisper.cpp fehlt: git clone --depth 1 -b v1.9.5 https://github.com/ggml-org/whisper.cpp android/third_party/whisper.cpp")
endif()

set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
# ARMv8.2 mit FP16 und Dot-Product: alle gängigen Handys seit etwa 2018
set(GGML_CPU_ARM_ARCH "armv8.2-a+fp16+dotprod" CACHE STRING "" FORCE)

add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_library(tsnative SHARED jni.cpp)
target_compile_options(tsnative PRIVATE -O3)
target_link_libraries(tsnative PRIVATE whisper log)
target_link_options(tsnative PRIVATE -Wl,--gc-sections)
