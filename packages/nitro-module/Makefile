# CrossNative Makefile
# Builds the C++ core (wasm3 + CrossNative) and a host test runner.
#
#   make            build libcrossnative.a
#   make check      compile the Rust example to WASM, build the runner, run tests
#   make clean      remove build artifacts

CC = clang
CXX = clang++
CFLAGS = -O3 -fPIC -I. -Icpp -Iwasm3 -std=c11
CXXFLAGS = -O3 -fPIC -I. -Icpp -Iwasm3 -std=c++17

# macOS puts dlopen in libSystem; only Linux needs an explicit -ldl.
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
  LDFLAGS = -lpthread
else
  LDFLAGS = -lpthread -ldl
endif

WASM3_SOURCES = \
	wasm3/m3_api_libc.c \
	wasm3/m3_bind.c \
	wasm3/m3_code.c \
	wasm3/m3_compile.c \
	wasm3/m3_core.c \
	wasm3/m3_env.c \
	wasm3/m3_exec.c \
	wasm3/m3_function.c \
	wasm3/m3_info.c \
	wasm3/m3_module.c \
	wasm3/m3_parse.c

CROSSNATIVE_SOURCES = \
	cpp/CrossNative.cpp \
	cpp/WasmRuntime.cpp \
	cpp/NativeModule.cpp \
	cpp/ThreadPool.cpp

WASM3_OBJECTS = $(WASM3_SOURCES:.c=.o)
CROSSNATIVE_OBJECTS = $(CROSSNATIVE_SOURCES:.cpp=.o)

# The Rust example module, compiled to WASM for the test suite.
RUST_SOURCE = test/fixtures/compute.rs
WASM_TARGET = build/compute.wasm

all: libcrossnative.a

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

libcrossnative.a: $(WASM3_OBJECTS) $(CROSSNATIVE_OBJECTS)
	ar rcs $@ $^
	ranlib $@

libcrossnative.so: $(WASM3_OBJECTS) $(CROSSNATIVE_OBJECTS)
	$(CXX) -shared -o $@ $^ $(LDFLAGS)

# Host test runner
test_runner: test/test_main.cpp libcrossnative.a
	$(CXX) $(CXXFLAGS) -o $@ $< -L. -lcrossnative $(LDFLAGS)

# stdio JSON host, used by the Node backend in @cross-native/core
crossnative-host: host/host_main.cpp libcrossnative.a
	$(CXX) $(CXXFLAGS) -o $@ $< -L. -lcrossnative $(LDFLAGS)

host: crossnative-host

# Compile the Rust example module to WASM
$(WASM_TARGET): $(RUST_SOURCE)
	@mkdir -p build
	rustc --target wasm32-unknown-unknown --crate-type=cdylib \
		-O -C strip=symbols $< -o $@

wasm: $(WASM_TARGET)

check: test_runner $(WASM_TARGET)
	./test_runner $(WASM_TARGET)

clean:
	rm -f $(WASM3_OBJECTS) $(CROSSNATIVE_OBJECTS) libcrossnative.a libcrossnative.so test_runner crossnative-host
	rm -rf build

.PHONY: all clean check wasm host
