cmake_minimum_required(VERSION 3.13)
project(crossnative C CXX ASM)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PACKAGE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)
set(WAMR_ROOT ${PACKAGE_ROOT}/wamr)

# WAMR sources are pinned to the set verified on the host build (interpreter/
# holds both interpreters, so a glob would double-define symbols), with the
# darwin platform swapped for android. This configuration is arm64-v8a only —
# the AOT reloc and trampoline are aarch64-specific, and the .aot CrossNative
# ships targets aarch64. Other ABIs are excluded below.
set(WAMR_C_SOURCES
    ${WAMR_ROOT}/core/iwasm/aot/aot_intrinsic.c
    ${WAMR_ROOT}/core/iwasm/aot/aot_loader.c
    ${WAMR_ROOT}/core/iwasm/aot/aot_runtime.c
    ${WAMR_ROOT}/core/iwasm/aot/arch/aot_reloc_aarch64.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_application.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_blocking_op.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_c_api.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_exec_env.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_loader_common.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_memory.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_native.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_runtime_common.c
    ${WAMR_ROOT}/core/iwasm/common/wasm_shared_memory.c
    ${WAMR_ROOT}/core/iwasm/interpreter/wasm_interp_fast.c
    ${WAMR_ROOT}/core/iwasm/interpreter/wasm_loader.c
    ${WAMR_ROOT}/core/iwasm/interpreter/wasm_runtime.c
    ${WAMR_ROOT}/core/iwasm/libraries/libc-builtin/libc_builtin_wrapper.c
    ${WAMR_ROOT}/core/shared/mem-alloc/ems/ems_alloc.c
    ${WAMR_ROOT}/core/shared/mem-alloc/ems/ems_gc.c
    ${WAMR_ROOT}/core/shared/mem-alloc/ems/ems_hmu.c
    ${WAMR_ROOT}/core/shared/mem-alloc/ems/ems_kfc.c
    ${WAMR_ROOT}/core/shared/mem-alloc/mem_alloc.c
    ${WAMR_ROOT}/core/shared/platform/common/memory/mremap.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_blocking_op.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_malloc.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_memmap.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_sleep.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_thread.c
    ${WAMR_ROOT}/core/shared/platform/common/posix/posix_time.c
    ${WAMR_ROOT}/core/shared/platform/android/platform_init.c
    ${WAMR_ROOT}/core/shared/utils/bh_assert.c
    ${WAMR_ROOT}/core/shared/utils/bh_bitmap.c
    ${WAMR_ROOT}/core/shared/utils/bh_common.c
    ${WAMR_ROOT}/core/shared/utils/bh_hashmap.c
    ${WAMR_ROOT}/core/shared/utils/bh_leb128.c
    ${WAMR_ROOT}/core/shared/utils/bh_list.c
    ${WAMR_ROOT}/core/shared/utils/bh_log.c
    ${WAMR_ROOT}/core/shared/utils/bh_queue.c
    ${WAMR_ROOT}/core/shared/utils/bh_vector.c
    ${WAMR_ROOT}/core/shared/utils/runtime_timer.c
)
set(WAMR_ASM_SOURCES
    ${WAMR_ROOT}/core/iwasm/common/arch/invokeNative_aarch64.s
)

# WAMR's aarch64 trampoline guards its ELF directives behind BH_PLATFORM_DARWIN
# (undefined here) and must be preprocessed for the #ifndef to apply.
# The NDK sets the aarch64 target on the C compiler; the ASM step doesn't
# inherit it, so pass it through explicitly or the trampoline is (mis)assembled
# as 32-bit ARM. -x assembler-with-cpp runs the preprocessor for the
# BH_PLATFORM_DARWIN guard.
set_source_files_properties(${WAMR_ASM_SOURCES} PROPERTIES
    LANGUAGE ASM
    COMPILE_FLAGS "-x assembler-with-cpp --target=aarch64-linux-android${CMAKE_SYSTEM_VERSION} -march=armv8-a")

add_library(crossnative SHARED
    ${WAMR_C_SOURCES}
    ${WAMR_ASM_SOURCES}
    ${PACKAGE_ROOT}/cpp/CrossNative.cpp
    ${PACKAGE_ROOT}/cpp/WasmRuntime.cpp
    ${PACKAGE_ROOT}/cpp/NativeModule.cpp
    ${PACKAGE_ROOT}/cpp/ThreadPool.cpp
    ${PACKAGE_ROOT}/jsi/CrossNativeJSI.cpp
    src/main/jni/CrossNativeJNI.cpp
)

target_compile_definitions(crossnative PRIVATE BH_MALLOC=wasm_runtime_malloc BH_FREE=wasm_runtime_free BH_PLATFORM_ANDROID BUILD_TARGET_AARCH64 BUILD_TARGET="aarch64v8" WASM_ENABLE_INTERP=1 WASM_ENABLE_FAST_INTERP=1 WASM_ENABLE_AOT=1 WASM_ENABLE_AOT_INTRINSICS=1 WASM_ENABLE_QUICK_AOT_ENTRY=1 WASM_ENABLE_LIBC_BUILTIN=1 WASM_ENABLE_BULK_MEMORY=1 WASM_ENABLE_REF_TYPES=1 WASM_ENABLE_SIMD=0 WASM_ENABLE_SHRUNK_MEMORY=1 WASM_ENABLE_MULTI_MODULE=0 WASM_ENABLE_SHARED_MEMORY=0 WASM_ENABLE_MINI_LOADER=0 WASM_ENABLE_EXTENDED_CONST_EXPR=0 WASM_DISABLE_HW_BOUND_CHECK=1 WASM_DISABLE_STACK_HW_BOUND_CHECK=1 WASM_DISABLE_WAKEUP_BLOCKING_OP=0 WASM_HAVE_MREMAP=0 WASM_GLOBAL_HEAP_SIZE=10485760)

target_include_directories(crossnative PRIVATE
    ${PACKAGE_ROOT}/cpp
    ${PACKAGE_ROOT}/jsi
    ${WAMR_ROOT}/core/iwasm/include
    ${WAMR_ROOT}/core/iwasm/interpreter
    ${WAMR_ROOT}/core/iwasm/aot
    ${WAMR_ROOT}/core/iwasm/common
    ${WAMR_ROOT}/core/iwasm/libraries/libc-builtin
    ${WAMR_ROOT}/core/shared/include
    ${WAMR_ROOT}/core/shared/mem-alloc
    ${WAMR_ROOT}/core/shared/platform/include
    ${WAMR_ROOT}/core/shared/platform/android
    ${WAMR_ROOT}/core/shared/utils
    ${WAMR_ROOT}/core/shared/utils/uncommon
)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

target_link_libraries(crossnative
    ReactAndroid::reactnative
    ReactAndroid::jsi
    fbjni::fbjni
    android
    log
)
