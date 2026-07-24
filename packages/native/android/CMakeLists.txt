cmake_minimum_required(VERSION 3.13)
project(crossnative)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The shared sources live one level up, next to the podspec.
set(PACKAGE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)

# Every wasm3 translation unit. Globbed rather than listed so the build cannot
# silently drift from the vendored tree — an earlier hand-written list omitted
# m3_module.c and m3_info.c, which made the interpreter impossible to link.
file(GLOB WASM3_SOURCES CONFIGURE_DEPENDS ${PACKAGE_ROOT}/wasm3/*.c)

add_library(crossnative SHARED
    ${WASM3_SOURCES}
    ${PACKAGE_ROOT}/cpp/CrossNative.cpp
    ${PACKAGE_ROOT}/cpp/WasmRuntime.cpp
    ${PACKAGE_ROOT}/cpp/NativeModule.cpp
    ${PACKAGE_ROOT}/cpp/ThreadPool.cpp
    ${PACKAGE_ROOT}/jsi/CrossNativeJSI.cpp
    src/main/jni/CrossNativeJNI.cpp
)

target_include_directories(crossnative PRIVATE
    ${PACKAGE_ROOT}/cpp
    ${PACKAGE_ROOT}/wasm3
    ${PACKAGE_ROOT}/jsi
)

# wasm3's interpreter loop is written with guaranteed tail calls. LLVM cannot
# emit those on the 32-bit ABIs, where the build dies with "failed to perform
# tail call elimination on a call site marked musttail". Falling back to
# ordinary calls costs some speed but only on these legacy ABIs; arm64-v8a and
# x86_64 keep the tail calls.
if(ANDROID_ABI STREQUAL "armeabi-v7a" OR ANDROID_ABI STREQUAL "x86")
    target_compile_definitions(crossnative PRIVATE M3_HAS_TAIL_CALL=0)
endif()

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

target_link_libraries(crossnative
    ReactAndroid::reactnative   # merged React Native core (0.76+)
    ReactAndroid::jsi
    fbjni::fbjni
    android
    log
)
