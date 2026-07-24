cmake_minimum_required(VERSION 3.10)
project(CrossNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(WASM3_SOURCES
    wasm3/wasm3.c
    wasm3/m3_api_libc.c
    wasm3/m3_bind.c
    wasm3/m3_code.c
    wasm3/m3_compile.c
    wasm3/m3_config.c
    wasm3/m3_core.c
    wasm3/m3_env.c
    wasm3/m3_exec.c
    wasm3/m3_function.c
    wasm3/m3_heap.c
    wasm3/m3_parse.c
)

set(CROSSNATIVE_SOURCES
    cpp/CrossNative.cpp
    cpp/WasmRuntime.cpp
    cpp/NativeModule.cpp
    cpp/ThreadPool.cpp
)

# Create static library
add_library(crossnative STATIC
    ${WASM3_SOURCES}
    ${CROSSNATIVE_SOURCES}
)

# Include directories
target_include_directories(crossnative PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/wasm3
    ${CMAKE_CURRENT_SOURCE_DIR}/../core/src
)

# Compiler flags
target_compile_options(crossnative PRIVATE
    -O3
    -fvisibility=hidden
    -fPIC
)

# Link libraries (for shared library loading)
target_link_libraries(crossnative PUBLIC
    ${CMAKE_DL_LIBS}
    pthread
)

# iOS-specific settings
if(IOS)
    set_target_properties(crossnative PROPERTIES
        FRAMEWORK TRUE
        FRAMEWORK_VERSION A
        MACOSX_FRAMEWORK_IDENTIFIER com.crossnative
        MACOSX_FRAMEWORK_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/Info.plist
        PUBLIC_HEADER "cpp/CrossNative.hpp;cpp/WasmRuntime.hpp;cpp/ThreadPool.hpp;cpp/NativeModule.hpp"
    )
endif()

# Enable position-independent code for Android
set_target_properties(crossnative PROPERTIES
    POSITION_INDEPENDENT_CODE ON
)

# Install targets
install(TARGETS crossnative
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    FRAMEWORK DESTINATION Frameworks
)
