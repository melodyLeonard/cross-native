# CrossNative C++ Implementation Plan

## Current State
- Headers complete: ✅ WasmRuntime.hpp, ThreadPool.hpp, NativeModule.hpp, CrossNative.hpp
- Implementation: 🟡 CrossNative.cpp has logic but uses stubs
- Missing: WasmRuntime.cpp (PIMPL implementation), NativeModule.cpp

## Implementation Steps

### 1. Choose WASM Engine
**Option A: wasm3** (Recommended)
- Pros: Lightweight (~100KB), fast, easy to embed
- Cons: No JIT (interpreter only)
- Best for: Mobile (small binary size)

**Option B: wasmtime**
- Pros: Cranelift JIT, very fast
- Cons: Large binary (~10MB), complex build
- Best for: Desktop/server

**Option C: WAMR (WebAssembly Micro Runtime)**
- Pros: Intel's runtime, AoT compilation
- Cons: Complex build system
- Best for: IoT/embedded

### 2. Files to Create
```
cpp/
├── WasmRuntime.cpp          # wasm3-based implementation
├── NativeModule.cpp         # WasmModule + SharedLibraryModule
├── wasm3/
│   ├── wasm3.h              # wasm3 header
│   ├── wasm3_defs.h         # wasm3 definitions
│   └── m3_api.h             # wasm3 API
└── CMakeLists.txt           # Updated with wasm3
```

### 3. Implementation Details

#### WasmRuntime::loadModule()
```cpp
bool WasmRuntime::loadModule(const std::string& id, const std::vector<uint8_t>& wasmBytes) {
    M3Result result;
    
    // Parse WASM module
    IM3Module module;
    result = m3_ParseModule(env_, &module, wasmBytes.data(), wasmBytes.size());
    if (result) return false;
    
    // Load module into runtime
    result = m3_LoadModule(runtime_, module);
    if (result) return false;
    
    // Link imports (memory, env)
    result = m3_LinkRawMemory(module, "env", "memory", &memory);
    
    modules_[id] = module;
    return true;
}
```

#### WasmRuntime::call()
```cpp
std::string WasmRuntime::call(const std::string& moduleId, 
                               const std::string& funcName,
                               const std::string& argsJson) {
    auto module = modules_[moduleId];
    
    // Find function
    IM3Function func = m3_FindFunction(module, funcName.c_str());
    if (!func) return error("Function not found");
    
    // Parse args from JSON
    auto args = parseArgs(argsJson);
    
    // Call function
    M3Result result = m3_CallV(func, args...);
    
    // Return result as JSON
    return formatResult(func);
}
```

### 4. Build Integration

#### iOS (CMakeLists.txt)
```cmake
# Add wasm3 source files
set(WASM3_SOURCES
    wasm3/wasm3.c
    wasm3/m3_api.c
    wasm3/m3_bind.c
    wasm3/m3_code.c
    wasm3/m3_compile.c
    wasm3/m3_config.c
    wasm3/m3_core.c
    wasm3/m3_env.c
    wasm3/m3_exec.c
    wasm3/m3_ext.c
    wasm3/m3_function.c
    wasm3/m3_heap.c
    wasm3/m3_parse.c
)

add_library(crossnative SHARED
    ${WASM3_SOURCES}
    WasmRuntime.cpp
    NativeModule.cpp
    ThreadPool.cpp
    CrossNative.cpp
)
```

### 5. Testing Plan
```cpp
// Test: Load WASM and call add
TEST(WasmRuntime, BasicMath) {
    WasmRuntime runtime;
    auto wasm = loadFile("compute.wasm");
    EXPECT_TRUE(runtime.loadModule("math", wasm));
    
    auto result = runtime.call("math", "add", "[1.5, 2.5]");
    EXPECT_EQ(result, "4.0");
}
```

## Timeline
- Day 1: Integrate wasm3, implement WasmRuntime.cpp
- Day 2: Implement NativeModule.cpp, fix CrossNative.cpp
- Day 3: Build integration (CMake, podspec, gradle)
- Day 4: Testing, debugging
- Day 5: Documentation, examples

## Dependencies
```bash
# wasm3
wget https://github.com/wasm3/wasm3/archive/refs/heads/main.zip
# or use git submodule
git submodule add https://github.com/wasm3/wasm3.git
```

## Risks
1. **Build complexity** - wasm3 needs C compiler
2. **iOS compatibility** - need to test on real device
3. **Performance** - interpreter vs JIT tradeoff
4. **Memory** - need proper memory management

## Recommendation
Start with **wasm3** for v0.1.0. It's proven in production (used by React Native, SwiftWasm) and has the right tradeoffs for mobile.

Switch to **wasmtime** for v0.2.0 if performance demands it.
