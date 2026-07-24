# CrossNative Implementation Guide

## 🎯 What We're Building

A **native module wrapper** that lets React Native developers:
1. Write performance-critical code in any compiled language (Rust, Go, C++, Zig)
2. Call that code seamlessly from JavaScript/TypeScript
3. Run it on separate threads so the UI never blocks
4. Get full TypeScript autocomplete for native functions

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              YOUR REACT NATIVE APP (JS THREAD)             │
│                                                          │
│   App.tsx ──▶ useNativeModule('math.rs') ──▶ math.add(1,2) │
│                                                          │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼ JSI (Zero-copy bridge)
┌─────────────────────────────────────────────────────────┐
│              C++ JSI BRIDGE LAYER                        │
│                                                          │
│   ┌─────────────────┐  ┌─────────────────────────────┐  │
│   │  Thread Pool    │  │   Type Converter            │  │
│   │                 │  │                             │  │
│   │  • Dispatch     │  │  JS Number ──▶ Rust f64     │  │
│   │  • Priority     │  │  JS Array  ──▶ Rust Vec     │  │
│   │  • Cancel       │  │  JS String ──▶ Rust String  │  │
│   └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              NATIVE RUNTIME (WORKER THREAD)              │
│                                                          │
│   ┌─────────────────────────────────────────────────┐  │
│   │              RUST RUNTIME                        │  │
│   │                                                 │  │
│   │  #[native_function]                            │  │
│   │  pub fn compute_matrix(data: Vec<f64>) {         │  │
│   │      // Runs at full native speed               │  │
│   │      // Zero UI blocking                         │  │
│   │  }                                               │  │
│   │                                                 │  │
│   │  Tokio async runtime for parallel execution     │  │
│   └─────────────────────────────────────────────────┘  │
│                                                          │
│   Future: Go Runtime | C++ Runtime | WASM Runtime        │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 File-by-File Breakdown

### 1. Project Configuration Files

#### `package.json` (Root)
- **What**: Workspace configuration for monorepo
- **Why**: TurboRepo manages building all packages in order
- **Key parts**:
  - `workspaces`: Defines packages/* as sub-packages
  - `scripts`: Commands that run across all packages

#### `turbo.json`
- **What**: TurboRepo pipeline configuration
- **Why**: Ensures packages build in correct order (core before cli)
- **Key parts**:
  - `pipeline`: Defines task dependencies
  - `dependsOn`: ["^build"] means "build dependencies first"

#### `tsconfig.json`
- **What**: TypeScript compiler configuration
- **Why**: Consistent type checking across all packages
- **Key settings**:
  - `strict: true`: Maximum type safety
  - `isolatedModules`: Required for React Native

---

### 2. Core Package (`packages/core/`)

#### `src/types.ts`
- **What**: All TypeScript type definitions
- **Why**: Single source of truth for the API
- **Key types**:
  - `NativeModule`: Interface all modules implement
  - `CallOptions`: Per-call configuration (priority, timeout)
  - `Plugin`: Extensible hook system
  - `CallContext`: Information passed through plugin hooks

#### `src/api/useNative.ts`
- **What**: React hook for using native modules
- **Why**: Developer-friendly API that handles lifecycle
- **How it works**:
  1. Creates bridge on mount
  2. Loads module via bridge
  3. Returns module proxy with plugin hooks
  4. Cleanup on unmount

```typescript
// Usage in component
const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
  plugins: [ConsolePlugin()]
});

// Later:
const result = await MathModule.call('add', [1, 2]);
```

#### `src/bridge/bridge.ts`
- **What**: JSI runtime connection
- **Why**: Talks directly to C++ layer
- **Key methods**:
  - `initialize()`: Sets up JSI runtime
  - `loadModule()`: Loads native module
  - `callNative()`: Makes actual native call

#### `src/plugins/console.ts`
- **What**: Debug logging plugin
- **Why**: See what's happening without native debugger
- **Features**:
  - Logs all native calls with timing
  - Optional argument/result logging
  - Error highlighting

#### `src/plugins/performance.ts`
- **What**: Performance tracking plugin
- **Why**: Identify slow native functions
- **Features**:
  - Tracks execution time
  - Warns on slow calls (>100ms default)
  - Keeps history for analysis

---

### 3. Native C++ Layer (`native/shared/`)

#### `include/bridge.h`
- **What**: C++ JSI bridge header
- **Why**: Defines interface between JS and native
- **Key classes**:
  - `JsiBridge`: Main bridge class
  - `NativeModule`: Abstract base for language modules

#### `include/thread_pool.h`
- **What**: Worker thread management
- **Why**: Runs native code without blocking JS
- **Key features**:
  - Priority queue (immediate/high/normal/low)
  - Task cancellation
  - Work stealing for efficiency

---

### 4. Rust Package (`packages/rust/`)

#### `Cargo.toml`
- **What**: Rust project configuration
- **Why**: Defines dependencies and build settings
- **Key dependencies**:
  - `tokio`: Async runtime for threading
  - `uniffi`: Generates language bindings
  - `serde`: JSON serialization for JS communication

#### `src/lib.rs`
- **What**: Rust runtime initialization
- **Why**: Entry point for all Rust native modules
- **Key functions**:
  - `cross_native_init()`: One-time setup
  - `cross_native_register_module()`: Add a module
  - `cross_native_call()`: Execute a function

#### `src/macros.rs`
- **What**: Procedural macros
- **Why**: Reduce boilerplate for developers
- **Macros**:
  - `#[native_function]`: Mark function callable from JS
  - `#[native_module]`: Mark struct as a module

---

### 5. Example App (`examples/rust-math/`)

#### `App.tsx`
- **What**: React Native example using CrossNative
- **Why**: Shows real-world usage
- **Demonstrates**:
  - Module configuration
  - Async calls with loading states
  - Error handling
  - Performance benefits

#### `native/math.rs`
- **What**: Example Rust math functions
- **Why**: Reference implementation
- **Functions**:
  - `add`: Simple sync function
  - `compute_matrix`: Heavy computation example
  - `fibonacci`: CPU-intensive recursive example

---

## 🔧 How It All Works Together

### Step-by-Step Flow

**1. Developer writes Rust code:**
```rust
#[native_function]
pub fn compute_matrix(data: Vec<f64>, size: usize) -> Result<Vec<f64>, String> {
    // Heavy computation
}
```

**2. Build process generates bindings:**
```bash
npx cross-native build
```
- Parses Rust function signatures
- Generates TypeScript definitions
- Generates C++ JSI bindings
- Compiles Rust to native library

**3. App loads module:**
```typescript
const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
});
```
- Creates JSI bridge
- Loads native library
- Registers functions

**4. Calling a function:**
```typescript
const result = await MathModule.call('computeMatrix', [data, 100]);
```
- JS calls into C++ bridge
- C++ converts JS types to C++ types
- C++ calls into Rust runtime
- Rust runs computation on worker thread
- Result flows back through the chain
- JS Promise resolves with result

---

## 🚀 Development Phases

### Phase 1: Foundation (Weeks 1-4)
**Goal**: Basic Rust → JS working

**Week 1**: Project setup
- [ ] Create all configuration files
- [ ] Set up build pipeline
- [ ] Create package structure

**Week 2**: C++ bridge
- [ ] Implement JSI connection
- [ ] Type conversion (JS ↔ C++)
- [ ] Thread pool

**Week 3**: Rust integration
- [ ] Rust runtime
- [ ] C FFI exports
- [ ] Basic function calls

**Week 4**: TypeScript API
- [ ] useNativeModule hook
- [ ] Plugin system
- [ ] Error handling

**Deliverable**: `npm run example` shows working demo

### Phase 2: Developer Experience (Weeks 5-8)
**Goal**: Easy to use, hard to misuse

**Week 5**: Code generation
- [ ] Parse Rust source files
- [ ] Generate TypeScript definitions
- [ ] Generate C++ bindings

**Week 6**: CLI tool
- [ ] `init` - setup in existing project
- [ ] `add` - add language support
- [ ] `build` - compile native code
- [ ] `run` - dev mode with hot reload

**Week 7**: Plugins
- [ ] Console logging
- [ ] Performance tracking
- [ ] Error reporting (Sentry)

**Week 8**: Documentation
- [ ] API docs
- [ ] Examples
- [ ] Best practices

**Deliverable**: New user can onboard in 10 minutes

### Phase 3: Multi-Language (Weeks 9-12)
**Goal**: Support multiple languages

**Week 9-10**: Go support
- [ ] Go ↔ C bindings
- [ ] Goroutine integration
- [ ] Type generation

**Week 11**: C++ direct
- [ ] Skip language bindings
- [ ] Direct TurboModule

**Week 12**: WASM
- [ ] WASM3 runtime
- [ ] Any WASM language

**Deliverable**: `language: 'go'` works same as `language: 'rust'`

### Phase 4: Production (Weeks 13-16)
**Goal**: Ready for real apps

**Week 13**: Observability
- [ ] OpenTelemetry plugin
- [ ] Memory profiling
- [ ] Performance dashboard

**Week 14**: Testing
- [ ] Unit tests >80% coverage
- [ ] Integration tests
- [ ] Benchmark suite

**Week 15**: Polish
- [ ] Error messages
- [ ] Debugging tools
- [ ] VS Code extension

**Week 16**: Release
- [ ] npm publish
- [ ] Documentation site
- [ ] Community announcement

**Deliverable**: v1.0 on npm

---

## 🎓 Key Concepts Explained

### What is JSI?

**Old React Native Bridge:**
```
JS: {a: 1, b: 2}  →  JSON.stringify  →  "{\"a\":1,\"b\":2}"
                    →  Async queue    →  Native parses JSON
                    →  Wait for turn  →  Execute
                    →  JSON response  →  JS parses JSON
```
**Latency: 15-30ms per call**

**JSI (JavaScript Interface):**
```
JS: number  →  Direct pointer  →  Native: double
JS: array   →  Shared memory   →  Native: ArrayBuffer
```
**Latency: 0.1-0.5ms per call**

JSI lets JS and C++ share memory directly. No serialization. No async queue.

### What are TurboModules?

TurboModules are the "new" way to write native modules:
- Type-safe (C++ types at compile time)
- Lazy loaded (only loaded when JS uses them)
- JSI-based (fast)

CrossNative generates TurboModule boilerplate so you never write C++.

### Why Rust?

1. **Memory safety**: No crashes from null pointers
2. **Performance**: Zero-cost abstractions
3. **FFI**: Easy to call from C/C++
4. **Tooling**: Cargo, great error messages
5. **WASM**: Can also compile to WebAssembly

### Why Not Just Use WASM?

WASM has limitations:
- No direct hardware access (SIMD limited)
- Sandboxed (can't use native APIs)
- Extra compilation step
- Larger binary size

CrossNative uses native code directly for maximum performance, with WASM as an option for sandboxing.

---

## 📚 Next Steps

1. **Start with examples/rust-math/** to see it working
2. **Read ARCHITECTURE.md** for deeper technical details
3. **Check ROADMAP.md** for current status
4. **Join Discord** for questions and help

---

*This guide is a living document. Please suggest improvements!*
