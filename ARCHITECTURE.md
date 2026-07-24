# CrossNative Architecture Deep Dive

## Overview

CrossNative is a **multi-layer abstraction** that bridges JavaScript/TypeScript with native compiled languages, prioritizing:
1. **Performance** — Zero-copy where possible, JSI over bridge
2. **Developer Experience** — No native code knowledge required
3. **Flexibility** — Pluggable languages, backends, and observability

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         JAVASCRIPT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Core API    │  │   Plugins    │  │      Developer Tools     │  │
│  │              │  │              │  │                          │  │
│  │ useNative()  │  │ • Logging    │  │ • CLI (init/add/build)   │  │
│  │ callNative() │  │ • Metrics    │  │ • VS Code Extension      │  │
│  │ batchCall()  │  │ • Error      │  │ • Type Generator         │  │
│  │              │  │   Tracking   │  │ • Hot Reload             │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ JSI (C++ Shared Layer)
┌─────────────────────────────────────────────────────────────────────┐
│                      NATIVE BRIDGE LAYER                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    JSI Runtime Manager                       │   │
│  │                                                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │ Type System  │  │ Memory Mgmt  │  │ Thread Scheduler │   │   │
│  │  │              │  │              │  │                  │   │   │
│  │  │ • Marshal JS │  │ • Ref Count  │  │ • Worklet Pool   │   │   │
│  │  │   <-> Native │  │ • Auto-free  │  │ • Priority Queue │   │   │
│  │  │ • Validation │  │ • Pooling    │  │ • Cancellation   │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  RUST BACKEND │    │  GO BACKEND   │    │  CPP BACKEND  │
│              │    │              │    │              │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ UniFFI   │ │    │ │ CGO      │ │    │ │ Direct   │ │
│ │ Bindings │ │    │ │ Bindings │ │    │ │ JSI      │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
│              │    │              │    │              │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ tokio    │ │    │ │ goroutine│ │    │ │ std::    │ │
│ │ runtime  │ │    │ │ runtime  │ │    │ │ thread   │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
└──────────────┘    └──────────────┘    └──────────────┘
```

---

## 🔑 Core Components

### 1. JSI Runtime Manager

The heart of CrossNative. JSI (JavaScript Interface) is Facebook's replacement for the old React Native bridge:

**Old Bridge (Slow):**
```
JS ──serialize──▶ JSON ──async──▶ Native ──deserialize──▶ Run
```

**JSI (Fast):**
```
JS ──direct pointer──▶ Native ──direct pointer──▶ JS
```

**Implementation:**
```cpp
// JsiBridge.h
#pragma once
#include <jsi/jsi.h>
#include <memory>
#include <future>

namespace crossnative {

using namespace facebook::jsi;

class JsiBridge {
public:
  // Synchronous call (small data, <1KB)
  Value callSync(Runtime& rt, const std::string& module, 
                 const std::string& method, const Value& args);
  
  // Asynchronous call (large data, compute-heavy)
  std::future<Value> callAsync(Runtime& rt, const std::string& module,
                               const std::string& method, const Value& args);
  
  // Zero-copy shared memory
  std::shared_ptr<ArrayBuffer> createSharedBuffer(size_t size);
  
private:
  std::unique_ptr<ThreadPool> workletPool_;
  std::unordered_map<std::string, NativeModuleRef> modules_;
};

} // namespace crossnative
```

### 2. Language Bindings Layer

Each language has a standard interface:

```typescript
// types/bindings.ts
interface NativeBinding {
  // Generate TypeScript definitions from native source
  generateTypes(sourcePath: string): Promise<TypeDefinition[]>;
  
  // Compile native code for target platform
  compile(options: CompileOptions): Promise<CompiledArtifact>;
  
  // Register module with JSI runtime
  register(runtime: JSIRuntime, module: NativeModule): void;
  
  // Call native function
  call(moduleId: string, methodId: string, args: unknown[]): Promise<unknown>;
}

interface TypeDefinition {
  name: string;
  parameters: Parameter[];
  returnType: string;
  isAsync: boolean;
}
```

### 3. Thread Scheduler

```cpp
// ThreadPool.h
#pragma once
#include <thread>
#include <queue>
#include <future>
#include <mutex>

namespace crossnative {

enum class Priority {
  IMMEDIATE,  // Run on calling thread if possible
  HIGH,       // Dedicated high-priority thread
  NORMAL,     // Standard worklet pool
  LOW         // Background processing
};

class ThreadPool {
public:
  explicit ThreadPool(size_t numThreads);
  ~ThreadPool();
  
  template<typename F, typename... Args>
  auto enqueue(Priority priority, F&& f, Args&&... args) 
    -> std::future<typename std::result_of<F(Args...)>::type>;
  
  // Cancel pending tasks for a module
  void cancelModule(const std::string& moduleId);
  
private:
  std::vector<std::thread> workers_;
  std::priority_queue<Task> tasks_;
  std::mutex queueMutex_;
  std::condition_variable condition_;
  bool stop_ = false;
};

} // namespace crossnative
```

---

## 🧵 Threading Model

CrossNative uses a **hybrid threading approach**:

### For Synchronous Calls (Fast Path)
```
JS Thread ──JSI──▶ Native Function ──JSI──▶ JS Thread
              │
              └── Runs on same thread, < 1ms expected
```

### For Asynchronous Calls (Heavy Work)
```
JS Thread ──JSI──▶ ThreadPool ──dispatch──▶ Worklet Thread
                                               │
                                               ▼
                                           Native Function
                                               │
                          ┌────────────────────┘
                          ▼
JS Thread ◄──JSI── Result ── Promise Resolution
```

### For Streaming/Large Data
```
Native Thread ──shared memory──▶ JS Thread
       │                             │
       └── writes to ArrayBuffer  ── reads without copy
```

---

## 📦 Package Structure

```
cross-native/
├── packages/
│   ├── core/                    # Main package
│   │   ├── src/
│   │   │   ├── api/            # Public API (useNative, etc.)
│   │   │   ├── bridge/         # JSI interface
│   │   │   ├── plugins/        # Plugin system
│   │   │   └── types/          # TypeScript definitions
│   │   └── package.json
│   │
│   ├── rust/                   # Rust language support
│   │   ├── src/
│   │   │   ├── compiler/       # Rust → native compilation
│   │   │   ├── bindings/        # UniFFI integration
│   │   │   └── templates/       # Code generation templates
│   │   └── package.json
│   │
│   ├── go/                     # Go language support (planned)
│   │   └── package.json
│   │
│   └── cli/                    # Command-line tools
│       ├── src/
│       │   ├── commands/        # init, add, build, run
│       │   ├── generators/      # Project scaffolding
│       │   └── watch/           # Hot reload
│       └── package.json
│
├── native/
│   ├── ios/                     # iOS native code
│   │   ├── CrossNative.mm
│   │   └── CrossNative.swift
│   │
│   ├── android/                 # Android native code
│   │   ├── build.gradle
│   │   └── src/main/cpp/
│   │       ├── JsiBridge.cpp
│   │       └── CMakeLists.txt
│   │
│   └── shared/                  # Cross-platform C++
│       ├── include/
│       │   ├── bridge.h
│       │   ├── thread_pool.h
│       │   └── memory.h
│       └── src/
│           ├── bridge.cpp
│           ├── thread_pool.cpp
│           └── memory.cpp
│
├── examples/
│   ├── rust-math/              # Rust + React Native math app
│   └── go-image-processing/    # Go + React Native image app
│
├── docs/
│   ├── getting-started.md
│   ├── architecture.md
│   └── api-reference.md
│
├── CONTRIBUTING.md
├── LICENSE
└── package.json
```

---

## 🔌 Plugin System

### Plugin Interface

```typescript
interface CrossNativePlugin {
  name: string;
  version: string;
  
  // Lifecycle hooks
  onModuleLoad?(module: NativeModule): void;
  onModuleUnload?(module: NativeModule): void;
  
  // Call hooks
  beforeCall?(context: CallContext): CallContext;
  afterCall?(context: CallContext, result: unknown): void;
  onError?(context: CallContext, error: Error): void;
  
  // Metrics hooks
  onMetrics?(metrics: PerformanceMetrics): void;
}

interface CallContext {
  moduleId: string;
  methodId: string;
  args: unknown[];
  timestamp: number;
  threadId: string;
}
```

### Built-in Plugins

1. **Sentry Plugin** — Error tracking and breadcrumbs
2. **OpenTelemetry Plugin** — Distributed tracing
3. **Console Plugin** — Development logging
4. **Performance Plugin** — Built-in metrics

---

## 🔒 Safety & Error Handling

### Memory Safety

```cpp
// Automatic reference counting for native objects
template<typename T>
class NativeRef {
public:
  NativeRef(T* ptr) : ptr_(ptr), count_(new size_t(1)) {}
  ~NativeRef() { release(); }
  
  NativeRef(const NativeRef& other) : ptr_(other.ptr_), count_(other.count_) {
    ++(*count_);
  }
  
  void release() {
    if (--(*count_) == 0) {
      delete ptr_;
      delete count_;
    }
  }
  
private:
  T* ptr_;
  size_t* count_;
};
```

### Error Propagation

```typescript
// Errors flow naturally from native to JS
// Rust Result -> JS rejected Promise
// Rust panic -> JS Error with stack trace

try {
  const result = await MathModule.riskyOperation();
} catch (error) {
  // error.message: "Rust panic: index out of bounds"
  // error.nativeStack: ["math.rs:42", "bridge.cpp:156"]
  // error.threadId: "worklet-3"
}
```

---

## 📊 Performance Characteristics

| Metric | Old Bridge | JSI (CrossNative) | Improvement |
|--------|-----------|-------------------|-------------|
| **Round-trip latency** | 15-30ms | 0.1-0.5ms | **60-300×** |
| **Data transfer** | JSON serialize | Zero-copy | **∞ (for large data)** |
| **Thread spawn** | N/A (single thread) | < 1ms | **New capability** |
| **Memory overhead** | High (copies) | Low (shared) | **10× less** |

---

## 🎯 Design Decisions

### Why JSI over TurboModules directly?

TurboModules are great but require C++ knowledge. CrossNative:
- Generates TurboModule boilerplate automatically
- Provides the C++ layer so devs never touch it
- Adds thread management TurboModules don't have

### Why UniFFI for Rust?

UniFFI (from Mozilla) generates bindings from Rust interface definitions:
- ✅ Type-safe by construction
- ✅ Generates TypeScript types automatically
- ✅ Handles memory management
- ✅ Proven in production (Firefox, Signal)

### Why not WASM?

WASM is promising but has limitations:
- ❌ No direct hardware access (SIMD, threads limited)
- ❌ Extra compilation step
- ❌ Larger bundle size
- ✅ Good for sandboxing untrusted code

**CrossNative will support WASM as a backend option** for languages that compile to it.

---

## 🚀 Next Steps

See [ROADMAP.md](./ROADMAP.md) for implementation phases.
