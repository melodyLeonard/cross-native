# CrossNative

> **Run any compiled language in React Native — with type safety, multiple threads, and zero native code knowledge required.**

[![npm version](https://img.shields.io/npm/v/react-native-cross-native.svg)](https://www.npmjs.com/package/react-native-cross-native)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 🎯 What Problem Does It Solve?

React Native runs all JavaScript on a **single thread**. When you have:

- O(n⁴) matrix computations
- Large data processing (50MB+ JSON)
- Real-time signal processing
- Cryptographic operations

The **UI freezes**. Users see janky scrolling, unresponsive buttons, dropped frames.

**CrossNative** solves this by moving heavy computation to native code that runs on separate threads.

---

## ✨ Developer Experience

```rust
// native/math.rs — Write in Rust
#[no_mangle]
pub extern "C" fn compute_matrix(data_ptr: *const f64, size: usize) -> *mut f64 {
    // Heavy O(n³) computation
    // Runs at native speed on separate thread
}
```

```tsx
// App.tsx — Use in React Native
import { useNativeModule } from 'react-native-cross-native';

const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
});

// UI stays at 60fps — computation runs off the main thread!
const result = await MathModule.call('computeMatrix', [data, 100]);
```

---

## ⚠️ Project status

Honest summary of what is and isn't working:

| Component | Status |
|-----------|--------|
| C++ core (wasm3 runtime, thread pool, marshalling) | ✅ Working — 17 tests, `make -C packages/nitro-module check` |
| Rust → WASM → call → result | ✅ Working — verified end-to-end |
| TypeScript API (`createNativeModule`, buffers, plugins) | ✅ Working — verified by `examples/node-demo` |
| Node development backend | ✅ Working |
| JSI / Nitro on-device backend | ❌ Not wired up — needs nitrogen codegen and a pod/gradle build |
| React Native example app | ❌ `example-app/App.tsx` still runs against a mock; there is no `ios/` or `android/` project |
| npm release | ❌ Not published |

The library is **not usable in a React Native app yet**. The engine underneath it
works and is tested; the on-device binding is the remaining gap.

---

## 🚀 Quick Start

```bash
# Install
npm install react-native-cross-native

# Write Rust (or Go, C++, Zig)
# Build — compiles to WASM + generates TypeScript
npx cross-native build

# Use in your app
const result = await NativeModule.call('myFunction', [args]);
```

See [QUICK_START.md](QUICK_START.md) for full details.

---

## 📊 Performance

Measured on an Apple Silicon Mac with `examples/node-demo`, comparing the wasm3
interpreter against Node's V8 JIT:

| Operation | JS (V8) | CrossNative (wasm3) | Ratio |
|-----------|---------|---------------------|-------|
| Matrix 120×120 | 2.9ms | 19.8ms | 6.7× slower |
| Process 200,000 items | 6.2ms | 187.2ms | 30× slower |
| Transfer 200,000 f64 (no real work) | 1.0ms | 33.8ms | 33.9× slower |
| Compute loop 2,000,000× | 42.7ms | 502.8ms | 11.8× slower |

Reproduce with:

```bash
make -C packages/nitro-module crossnative-host wasm && node --experimental-strip-types examples/node-demo/demo.ts
```

**Read this table carefully — it does not say what you might expect.**

wasm3 is an *interpreter*. V8 is an optimising JIT. On raw numeric code V8 wins
by roughly an order of magnitude, and no amount of tuning changes that.
CrossNative does not make computation faster than JavaScript on a desktop.

Two things matter for the real target, though:

1. **React Native does not run V8.** It runs Hermes, which has no optimising JIT
   for numeric code and is far slower than V8 at exactly this kind of work. The
   on-device comparison is wasm3 vs Hermes, which is a different question — and
   one this project has not measured yet. Do not assume either direction.
2. **iOS forbids JIT** for third-party apps, so any WASM runtime on iOS is an
   interpreter or AoT-compiled. This is why wasm3 was chosen. Genuine native
   speed on iOS requires compiling Rust into the app binary at build time and
   calling it over FFI — a different architecture from loading WASM at runtime.

What CrossNative *does* deliver today is **the work happens off the JS thread**.
The demo verifies this directly: the JS event loop ticked 1,076 times during a
1,217ms native call. That is the property that keeps a UI at 60fps, and it holds
regardless of the raw throughput comparison.

The transfer row is also worth noting: moving 200,000 doubles across the bridge
costs ~34ms, because arguments are currently marshalled as JSON. For large
arrays this dominates. Reducing it is tracked in [ROADMAP.md](ROADMAP.md).

---

## 🏗 Architecture

CrossNative is built on **Nitro Modules** (by Margelo) — the fastest native module system for React Native:

```
React Native (JS Thread)
    │
    ▼ JSI — Direct memory access, no JSON serialization
    │
Nitro Bridge (C++) — 16× faster than TurboModules
    │
    ├── Thread Pool — Priority queue, work stealing
    │   ├── Worker 1: Rust WASM module
    │   ├── Worker 2: Go WASM module
    │   └── Worker 3: C++ shared library
    │
    └── Shared Memory — Zero-copy ArrayBuffer transfer
```

**Key advantages over existing solutions:**

| Feature | CrossNative | react-native-worklets | react-native-multithreading |
|---------|-------------|----------------------|---------------------------|
| Language support | **Any** (via WASM) | JavaScript only | JavaScript only |
| Execution | Off the JS thread | Off the JS thread | Off the JS thread |
| Raw throughput | Interpreted WASM — see [Performance](#-performance) | JS engine speed | JS engine speed |
| Type safety | Auto-generated | Manual | Manual |
| Threading | **Automatic** | Manual | Manual |

---

## 🛠 Supported Languages

| Language | Status | Compilation |
|----------|--------|-------------|
| **Rust** | ✅ Working — verified end-to-end by the test suite and Node demo | WASM |
| **Go** | 🔵 Planned — the runtime will load any `.wasm`, but TinyGo compilation is not wired into the CLI | WASM (TinyGo) |
| **C++** | 🟡 Partial — `SharedLibraryModule` loads a `.dylib`/`.so` exporting `crossnative_call`, untested | Native |
| **Zig** | 🔵 Planned | WASM |
| **AssemblyScript** | 🔵 Planned | WASM |

Any language that compiles to a `wasm32` binary exporting `cn_alloc`/`cn_free`
will load today — the runtime is not Rust-specific. What is Rust-specific is the
CLI's compile step.

---

## 📦 Installation

```bash
npm install react-native-cross-native react-native-nitro-modules

# iOS
cd ios && pod install

# Android — handled by autolinking
```

Requirements:
- React Native 0.73+
- iOS 13+ / Android API 21+
- Xcode 14+ / Android Studio Hedgehog+

---

## 📖 Documentation

- [Quick Start](QUICK_START.md) — Get running in 5 minutes
- [Architecture](ARCHITECTURE.md) — How it works under the hood
- [API Reference](docs/api.md) — Complete API documentation
- [Examples](examples/) — Working code samples
- [Contributing](CONTRIBUTING.md) — Development setup

---

## 🧪 Examples

### Math Operations
```tsx
const Math = useNativeModule({ name: 'math', language: 'rust' });
const sum = await Math.call('add', [1, 2]); // 3
```

### Heavy Computation (UI stays responsive!)
```tsx
const Matrix = useNativeModule({ name: 'matrix', language: 'rust' });

// 500×500 matrix — runs on separate thread
const result = await Matrix.call('multiply', [a, b, 500], {
  priority: 'high',
});
```

### Zero-Copy Data Transfer
```tsx
// For large arrays — no data copying!
const buffer = createSharedBuffer(1024 * 1024); // 1MB

await Module.call('processBuffer', [buffer], {
  zeroCopy: true,
});
```

See [examples/rust-math](examples/rust-math/) for complete working app.

---

## 🔌 Plugin System

```tsx
import { ConsolePlugin, PerformancePlugin } from 'react-native-cross-native';

const Module = useNativeModule({
  name: 'math',
  language: 'rust',
  plugins: [
    ConsolePlugin({ logArgs: true }),
    PerformancePlugin({ slowThresholdMs: 50 }),
  ],
});
```

**Built-in plugins:**
- `ConsolePlugin` — Debug logging with timing
- `PerformancePlugin` — Track slow calls, keep history
- `SentryPlugin` (planned) — Error tracking
- `OpenTelemetryPlugin` (planned) — Distributed tracing

---

## 🗺 Roadmap

### Phase 1: Foundation (Q2 2026)
- [x] Nitro-based core architecture
- [x] WASM runtime for multi-language support
- [x] Thread pool with priority scheduling
- [x] TypeScript code generation
- [ ] Rust compiler integration
- [ ] npm release

### Phase 2: Multi-Language (Q3 2026)
- [ ] Go (TinyGo) support
- [ ] C++ direct bindings
- [ ] Zig support
- [ ] AssemblyScript support

### Phase 3: Production Polish (Q4 2026)
- [ ] Hot reload for native code
- [ ] VS Code extension
- [ ] Sentry/OpenTelemetry plugins
- [ ] Performance profiler
- [ ] v1.0 release

See [ROADMAP.md](ROADMAP.md) for detailed timeline.

---

## 🤝 Contributing

We'd love your help! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Setting up the development environment
- Adding a new language backend
- Writing plugins
- Improving documentation

---

## 📄 License

Apache-2.0 — See [LICENSE](LICENSE)

---

Built with ❤️ by developers who believe mobile apps shouldn't feel slow.

**[Get Started →](QUICK_START.md)**
