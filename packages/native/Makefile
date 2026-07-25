# CrossNative Makefile — WAMR backend
# Builds the C++ core (WAMR + CrossNative) and a host test runner.
#
#   make            build libcrossnative.a
#   make check      compile the Rust example to WASM, build the runner, run tests
#   make clean      remove build artifacts

CC  = clang
CXX = clang++

WAMR_ROOT = wamr

# Host OS and architecture, so the same Makefile builds on macOS (arm64/x86_64)
# and Linux (x86_64) — used by CI and local dev. Device builds go through the
# podspec (iOS) and CMake (Android) instead.
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
  PLATFORM_DEF  = -DBH_PLATFORM_DARWIN
  PLATFORM_DIR  = darwin
  SDK_ISYSROOT  = -isysroot $(shell xcrun --sdk macosx --show-sdk-path)
  LDFLAGS       = -lpthread
else
  PLATFORM_DEF  = -DBH_PLATFORM_LINUX
  PLATFORM_DIR  = linux
  SDK_ISYSROOT  =
  LDFLAGS       = -lpthread -ldl
endif

ifneq (,$(filter arm64 aarch64,$(UNAME_M)))
  ARCH_DEF        = -DBUILD_TARGET_AARCH64 -DBUILD_TARGET=\"aarch64v8\"
  ARCH_RELOC      = $(WAMR_ROOT)/core/iwasm/aot/arch/aot_reloc_aarch64.c
  ARCH_TRAMPOLINE = $(WAMR_ROOT)/core/iwasm/common/arch/invokeNative_aarch64.s
else
  ARCH_DEF        = -DBUILD_TARGET_X86_64 -DBUILD_TARGET=\"X86_64\"
  ARCH_RELOC      = $(WAMR_ROOT)/core/iwasm/aot/arch/aot_reloc_x86_64.c
  ARCH_TRAMPOLINE = $(WAMR_ROOT)/core/iwasm/common/arch/invokeNative_em64.s
endif

# Feature defines — both the cmake-style WAMR_BUILD_ and the internal WASM_ENABLE_ prefixes.
WAMR_DEFS = \
	-DBH_MALLOC=wasm_runtime_malloc -DBH_FREE=wasm_runtime_free \
	$(PLATFORM_DEF) $(ARCH_DEF) \
	-DWASM_ENABLE_INTERP=1 -DWASM_ENABLE_FAST_INTERP=1 \
	-DWASM_ENABLE_AOT=1 -DWASM_ENABLE_AOT_INTRINSICS=1 -DWASM_ENABLE_QUICK_AOT_ENTRY=1 \
	-DWASM_ENABLE_LIBC_BUILTIN=1 -DWASM_ENABLE_LIBC_WASI=1 -DWASM_ENABLE_MODULE_INST_CONTEXT=1 \
	-DWASM_ENABLE_BULK_MEMORY=1 -DWASM_ENABLE_REF_TYPES=1 \
	-DWASM_ENABLE_SIMD=0 -DWASM_ENABLE_SHRUNK_MEMORY=1 \
	-DWASM_ENABLE_MULTI_MODULE=0 -DWASM_ENABLE_SHARED_MEMORY=0 -DWASM_ENABLE_MINI_LOADER=0 \
	-DWASM_ENABLE_EXTENDED_CONST_EXPR=0 \
	-DWASM_DISABLE_HW_BOUND_CHECK=1 -DWASM_DISABLE_STACK_HW_BOUND_CHECK=1 \
	-DWASM_DISABLE_WAKEUP_BLOCKING_OP=0 -DWASM_HAVE_MREMAP=0 \
	-DWASM_GLOBAL_HEAP_SIZE=10485760 -DNDEBUG

WAMR_INC = \
	-I$(WAMR_ROOT)/core/iwasm/include \
	-I$(WAMR_ROOT)/core/iwasm/interpreter \
	-I$(WAMR_ROOT)/core/iwasm/aot \
	-I$(WAMR_ROOT)/core/iwasm/common \
	-I$(WAMR_ROOT)/core/iwasm/libraries/libc-builtin \
	-I$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/include \
	-I$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src \
	-I$(WAMR_ROOT)/core/shared/platform/common/libc-util \
	-I$(WAMR_ROOT)/core/shared/include \
	-I$(WAMR_ROOT)/core/shared/mem-alloc \
	-I$(WAMR_ROOT)/core/shared/platform/include \
	-I$(WAMR_ROOT)/core/shared/platform/$(PLATFORM_DIR) \
	-I$(WAMR_ROOT)/core/shared/utils \
	-I$(WAMR_ROOT)/core/shared/utils/uncommon

CFLAGS   = -O3 -fPIC -I. -Icpp $(WAMR_INC) $(WAMR_DEFS) -std=c11
CXXFLAGS = -O3 -fPIC -I. -Icpp $(WAMR_INC) $(WAMR_DEFS) -std=c++17

WAMR_SOURCES = \
	$(WAMR_ROOT)/core/iwasm/aot/aot_intrinsic.c \
	$(WAMR_ROOT)/core/iwasm/aot/aot_loader.c \
	$(WAMR_ROOT)/core/iwasm/aot/aot_runtime.c \
	$(ARCH_RELOC) \
	$(ARCH_TRAMPOLINE) \
	$(WAMR_ROOT)/core/iwasm/common/wasm_application.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_blocking_op.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_c_api.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_exec_env.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_loader_common.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_memory.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_native.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_runtime_common.c \
	$(WAMR_ROOT)/core/iwasm/common/wasm_shared_memory.c \
	$(WAMR_ROOT)/core/iwasm/interpreter/wasm_interp_fast.c \
	$(WAMR_ROOT)/core/iwasm/interpreter/wasm_loader.c \
	$(WAMR_ROOT)/core/iwasm/interpreter/wasm_runtime.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-builtin/libc_builtin_wrapper.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/libc_wasi_wrapper.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/posix.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/str.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/random.c \
	$(WAMR_ROOT)/core/iwasm/libraries/libc-wasi/sandboxed-system-primitives/src/blocking_op.c \
	$(WAMR_ROOT)/core/shared/platform/common/libc-util/libc_errno.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_file.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_clock.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_socket.c \
	$(WAMR_ROOT)/core/shared/mem-alloc/ems/ems_alloc.c \
	$(WAMR_ROOT)/core/shared/mem-alloc/ems/ems_gc.c \
	$(WAMR_ROOT)/core/shared/mem-alloc/ems/ems_hmu.c \
	$(WAMR_ROOT)/core/shared/mem-alloc/ems/ems_kfc.c \
	$(WAMR_ROOT)/core/shared/mem-alloc/mem_alloc.c \
	$(WAMR_ROOT)/core/shared/platform/common/memory/mremap.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_blocking_op.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_malloc.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_memmap.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_sleep.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_thread.c \
	$(WAMR_ROOT)/core/shared/platform/common/posix/posix_time.c \
	$(WAMR_ROOT)/core/shared/platform/$(PLATFORM_DIR)/platform_init.c \
	$(WAMR_ROOT)/core/shared/utils/bh_assert.c \
	$(WAMR_ROOT)/core/shared/utils/bh_bitmap.c \
	$(WAMR_ROOT)/core/shared/utils/bh_common.c \
	$(WAMR_ROOT)/core/shared/utils/bh_hashmap.c \
	$(WAMR_ROOT)/core/shared/utils/bh_leb128.c \
	$(WAMR_ROOT)/core/shared/utils/bh_list.c \
	$(WAMR_ROOT)/core/shared/utils/bh_log.c \
	$(WAMR_ROOT)/core/shared/utils/bh_queue.c \
	$(WAMR_ROOT)/core/shared/utils/bh_vector.c \
	$(WAMR_ROOT)/core/shared/utils/runtime_timer.c

CROSSNATIVE_SOURCES = \
	cpp/CrossNative.cpp \
	cpp/WasmRuntime.cpp \
	cpp/NativeModule.cpp \
	cpp/ThreadPool.cpp

WAMR_OBJECTS = $(patsubst %.s,%.o,$(WAMR_SOURCES:.c=.o))
CROSSNATIVE_OBJECTS = $(CROSSNATIVE_SOURCES:.cpp=.o)

# The Rust test fixture. A cargo crate, because #[crossnative] is a proc macro.
FIXTURE_DIR = test/fixtures/compute
FIXTURE_SOURCES = $(wildcard $(FIXTURE_DIR)/src/*.rs) $(FIXTURE_DIR)/Cargo.toml
FIXTURE_WASM = $(FIXTURE_DIR)/target/wasm32-unknown-unknown/release/compute.wasm
WASM_TARGET = build/compute.wasm

all: libcrossnative.a

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

%.o: %.s
	$(CC) -x assembler-with-cpp $(SDK_ISYSROOT) $(WAMR_DEFS) -c $< -o $@

libcrossnative.a: $(WAMR_OBJECTS) $(CROSSNATIVE_OBJECTS)
	ar rcs $@ $^
	ranlib $@

libcrossnative.so: $(WAMR_OBJECTS) $(CROSSNATIVE_OBJECTS)
	$(CXX) -shared -o $@ $^ $(LDFLAGS)

# Host test runner
test_runner: test/test_main.cpp libcrossnative.a
	$(CXX) $(CXXFLAGS) -o $@ $< -L. -lcrossnative $(LDFLAGS)

# stdio JSON host, used by the Node backend in @cross-native/core
crossnative-host: host/host_main.cpp libcrossnative.a
	$(CXX) $(CXXFLAGS) -o $@ $< -L. -lcrossnative $(LDFLAGS)

host: crossnative-host

# Compile the Rust fixture to WASM
$(WASM_TARGET): $(FIXTURE_SOURCES)
	cd $(FIXTURE_DIR) && cargo build --target wasm32-unknown-unknown --release
	@mkdir -p build
	cp $(FIXTURE_WASM) $@

wasm: $(WASM_TARGET)

check: test_runner $(WASM_TARGET)
	./test_runner $(WASM_TARGET)

# AOT verification. Provide the WAMR AOT compiler via WAMRC (see
# packages/compiler for automatic acquisition). The software-bounds + no-SIMD
# flags match the runtime's build configuration.
WAMRC ?= wamrc
AOT_TARGET = build/compute.aot
$(AOT_TARGET): $(WASM_TARGET)
	$(WAMRC) --target=aarch64v8 --bounds-checks=1 --disable-simd -o $@ $(WASM_TARGET)

check-aot: test_runner $(AOT_TARGET)
	./test_runner $(AOT_TARGET)

clean:
	rm -f $(WAMR_OBJECTS) $(CROSSNATIVE_OBJECTS) libcrossnative.a libcrossnative.so test_runner crossnative-host
	rm -rf build

.PHONY: all clean check check-aot wasm host
