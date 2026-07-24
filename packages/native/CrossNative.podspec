require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "CrossNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  # WAMR C sources are pinned to the exact set verified on the host build rather
  # than globbed: interpreter/ holds both the classic and fast interpreters
  # (globbing both double-defines symbols), and arch/ holds many invokeNative
  # variants. AOT sources are intentionally excluded until the AOT phase.
  s.source_files = [
    "ios/**/*.{h,m,mm}",
    "jsi/**/*.{hpp,cpp}",
    "cpp/**/*.{h,hpp,c,cpp}",
    "wamr/core/iwasm/common/arch/invokeNative_aarch64.s",
    "wamr/core/iwasm/aot/aot_intrinsic.c",
    "wamr/core/iwasm/aot/aot_loader.c",
    "wamr/core/iwasm/aot/aot_runtime.c",
    "wamr/core/iwasm/aot/arch/aot_reloc_aarch64.c",
    "wamr/core/iwasm/common/wasm_application.c",
    "wamr/core/iwasm/common/wasm_blocking_op.c",
    "wamr/core/iwasm/common/wasm_c_api.c",
    "wamr/core/iwasm/common/wasm_exec_env.c",
    "wamr/core/iwasm/common/wasm_loader_common.c",
    "wamr/core/iwasm/common/wasm_memory.c",
    "wamr/core/iwasm/common/wasm_native.c",
    "wamr/core/iwasm/common/wasm_runtime_common.c",
    "wamr/core/iwasm/common/wasm_shared_memory.c",
    "wamr/core/iwasm/interpreter/wasm_interp_fast.c",
    "wamr/core/iwasm/interpreter/wasm_loader.c",
    "wamr/core/iwasm/interpreter/wasm_runtime.c",
    "wamr/core/iwasm/libraries/libc-builtin/libc_builtin_wrapper.c",
    "wamr/core/iwasm/libraries/libc-wasi/libc_wasi_wrapper.c",
    "wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/posix.c",
    "wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/str.c",
    "wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/random.c",
    "wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/blocking_op.c",
    "wamr/core/shared/platform/common/libc-util/libc_errno.c",
    "wamr/core/shared/platform/common/posix/posix_file.c",
    "wamr/core/shared/platform/common/posix/posix_clock.c",
    "wamr/core/shared/platform/common/posix/posix_socket.c",
    "wamr/core/shared/mem-alloc/ems/ems_alloc.c",
    "wamr/core/shared/mem-alloc/ems/ems_gc.c",
    "wamr/core/shared/mem-alloc/ems/ems_hmu.c",
    "wamr/core/shared/mem-alloc/ems/ems_kfc.c",
    "wamr/core/shared/mem-alloc/mem_alloc.c",
    "wamr/core/shared/platform/common/memory/mremap.c",
    "wamr/core/shared/platform/common/posix/posix_blocking_op.c",
    "wamr/core/shared/platform/common/posix/posix_malloc.c",
    "wamr/core/shared/platform/common/posix/posix_memmap.c",
    "wamr/core/shared/platform/common/posix/posix_sleep.c",
    "wamr/core/shared/platform/common/posix/posix_thread.c",
    "wamr/core/shared/platform/common/posix/posix_time.c",
    "wamr/core/shared/platform/darwin/platform_init.c",
    "wamr/core/shared/utils/bh_assert.c",
    "wamr/core/shared/utils/bh_bitmap.c",
    "wamr/core/shared/utils/bh_common.c",
    "wamr/core/shared/utils/bh_hashmap.c",
    "wamr/core/shared/utils/bh_leb128.c",
    "wamr/core/shared/utils/bh_list.c",
    "wamr/core/shared/utils/bh_log.c",
    "wamr/core/shared/utils/bh_queue.c",
    "wamr/core/shared/utils/bh_vector.c",
    "wamr/core/shared/utils/runtime_timer.c"
  ]

  s.preserve_paths = "wamr/**/*.h"

  s.private_header_files = [
    "jsi/**/*.hpp",
    "cpp/**/*.{h,hpp}",
    "wamr/core/**/*.h",
  ]

  s.dependency "React-Core"
  s.dependency "React-callinvoker"
  s.dependency "React-jsi"

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
      "\"$(PODS_TARGET_SRCROOT)/jsi\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/include\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/interpreter\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/aot\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/common\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/libraries/libc-builtin\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/include\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/platform/common/libc-util\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/include\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/mem-alloc\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/platform/include\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/platform/darwin\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/utils\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/utils/uncommon\""
    ].join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # WAMR feature configuration, matching the verified host build. Applies to
    # the whole pod target; harmless to the C++ glue.
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) BH_MALLOC=wasm_runtime_malloc BH_FREE=wasm_runtime_free BH_PLATFORM_DARWIN BUILD_TARGET_AARCH64 WASM_ENABLE_INTERP=1 WASM_ENABLE_FAST_INTERP=1 WASM_ENABLE_AOT=1 WASM_ENABLE_AOT_INTRINSICS=1 WASM_ENABLE_QUICK_AOT_ENTRY=1 BUILD_TARGET_AARCH64 BUILD_TARGET=\\\"aarch64v8\\\" WASM_ENABLE_LIBC_BUILTIN=1 WASM_ENABLE_LIBC_WASI=1 WASM_ENABLE_MODULE_INST_CONTEXT=1 WASM_ENABLE_BULK_MEMORY=1 WASM_ENABLE_REF_TYPES=1 WASM_ENABLE_SIMD=0 WASM_ENABLE_SHRUNK_MEMORY=1 WASM_ENABLE_MULTI_MODULE=0 WASM_ENABLE_SHARED_MEMORY=0 WASM_ENABLE_MINI_LOADER=0 WASM_ENABLE_EXTENDED_CONST_EXPR=0 WASM_DISABLE_HW_BOUND_CHECK=1 WASM_DISABLE_STACK_HW_BOUND_CHECK=1 WASM_DISABLE_WAKEUP_BLOCKING_OP=0 WASM_HAVE_MREMAP=0 WASM_GLOBAL_HEAP_SIZE=10485760 NDEBUG",
    # WAMR uses computed goto and takes label addresses.
    "GCC_WARN_ABOUT_RETURN_TYPE" => "NO",
    # WAMR's aarch64 trampoline guards ELF-only directives behind
    # BH_PLATFORM_DARWIN, which only takes effect when the .s is preprocessed.
    "OTHER_CFLAGS" => "$(inherited)",
    "GCC_INPUT_FILETYPE" => "automatic",
  }
end
