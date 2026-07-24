cmake_minimum_required(VERSION 3.13)
project(crossnative)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The shared sources live one level up, next to the podspec.
set(PACKAGE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)

# Include WAMR source files
set(WAMR_ROOT ${PACKAGE_ROOT}/wamr)
file(GLOB_RECURSE WAMR_SOURCES 
    ${WAMR_ROOT}/core/iwasm/common/*.c
    ${WAMR_ROOT}/core/iwasm/interpreter/*.c
    ${WAMR_ROOT}/core/shared/utils/*.c
    ${WAMR_ROOT}/core/shared/mem-alloc/*.c
    ${WAMR_ROOT}/core/shared/platform/android/*.c
)

add_library(crossnative SHARED
    ${WAMR_SOURCES}
    ${PACKAGE_ROOT}/cpp/CrossNative.cpp
    ${PACKAGE_ROOT}/cpp/WasmRuntime.cpp
    ${PACKAGE_ROOT}/cpp/NativeModule.cpp
    ${PACKAGE_ROOT}/cpp/ThreadPool.cpp
    ${PACKAGE_ROOT}/jsi/CrossNativeJSI.cpp
    src/main/jni/CrossNativeJNI.cpp
)

target_include_directories(crossnative PRIVATE
    ${PACKAGE_ROOT}/cpp
    ${PACKAGE_ROOT}/jsi
    ${WAMR_ROOT}/core/iwasm/include
    ${WAMR_ROOT}/core/shared/utils
    ${WAMR_ROOT}/core/shared/mem-alloc
    ${WAMR_ROOT}/core/shared/platform/include
)

# Enable LLVM JIT for Android
if(ANDROID_ABI STREQUAL "arm64-v8a" OR ANDROID_ABI STREQUAL "x86_64")
    target_compile_definitions(crossnative PRIVATE WAMR_BUILD_JIT=1)
else()
    target_compile_definitions(crossnative PRIVATE WAMR_BUILD_FAST_INTERP=1)
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
