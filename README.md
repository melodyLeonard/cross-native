# CrossNative

> Run compiled languages off the JavaScript thread, with type safety and no native code knowledge required.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

React Native runs all JavaScript on a single thread. Matrix maths, large data
processing, signal processing and cryptography all block it, and the UI stops
responding. CrossNative moves that work into a WASM module executed on a worker
thread, so the JS thread stays free.

```rust
// compute.rs — write it in Rust
#[no_mangle]
pub extern "C" fn matrix_multiply(a: *const f64, b: *const f64, out: *mut f64, n: usize) {
    // heavy O(n³) work
}
```

```typescript
// use it from TypeScript
import { createNativeModule, outBuffer } from '@cross-native/core';

const compute = await createNativeModule({
  name: 'compute',
  source: './native/compute.rs',
  language: 'rust',
});

const product = await compute.call('matrix_multiply', [a, b, outBuffer(n * n), n]);
```

---

## Status — Rust beats JS on both platforms

Write a plain `.rs`, no cargo commands, call it from JS off the UI thread — and
it runs **faster than JavaScript**, verified on real devices:

| Benchmark | Platform | Rust | JS (Hermes) | |
|-----------|----------|------|-------------|--|
| Float loop, 3M iterations | iOS (native FFI) | **25ms** | 195ms | 🦀 7.8× |
| Matrix 120×120 | iOS (native FFI) | **16ms** | 58ms | 🦀 3.6× |
| Float loop, 3M iterations | Android (WASM-AOT) | **81ms** | 286ms | 🦀 3.5× |
| Matrix 120×120 | Android (WASM-AOT) | **20ms** | 40ms | 🦀 2.0× |

Every run kept the UI thread live.

| Component | Status |
|-----------|--------|
| C++ core — WAMR runtime, thread pool, argument marshalling | ✅ 22 checks |
| `#[crossnative]` macro — plain Rust, named typed calls | ✅ |
| Language registry + validation | ✅ |
| Zero-config `.rs` (Metro transformer, no cargo) | ✅ |
| TypeScript API, Node dev backend, JSI backend | ✅ 19 checks |
| **iOS** — native FFI (Rust linked into the app, App-Store-legal) | ✅ 7.8× on device |
| **Android** — WASM interpreter + AOT (runtime `.aot`) | ✅ 3.5× on device |
| npm release | ❌ Not published |

Each platform takes the fastest legal path: iOS links native Rust (it forbids
runtime code loading); Android loads AOT-compiled WASM at runtime (it allows
executable memory). The WASM **interpreter** works everywhere as the portable
dev/fallback path. All three come from the same `#[crossnative]` source.

---

## Getting started

Requirements: Node 22.6+, a C++17 compiler, `make`, and Rust with the
`wasm32-unknown-unknown` target.

```bash
rustup target add wasm32-unknown-unknown
npm test
```

That compiles wasm3 and the C++ core, builds the Rust fixture to WASM, and runs
both suites. There is no `npm install` step — the core has no runtime
dependencies, and its TypeScript runs directly on Node via type stripping.

Individual suites:

```bash
npm run test:native   # C++ core (packages/native/test)
npm run test:core     # TypeScript API (packages/core/test)
```

---

## Using it in a React Native app

```bash
npm install react-native-cross-native
cd ios && pod install   # Android links automatically
```

Metro has no loader for `.wasm` and asset resolution differs by platform, so
embed the module in the bundle and pass the bytes:

```typescript
import { createNativeModule, outBuffer } from 'react-native-cross-native';

const compute = await createNativeModule({
  name: 'compute',
  source: './native/compute.rs',
  language: 'rust',
  bytes: myWasmBytes,   // Uint8Array
});

const sum = await compute.call('add', [1.5, 2.5]);
```

`createNativeModule` installs the native proxy on first use. If the app is
linked from a sibling checkout rather than node_modules, add the library root
to Metro's `watchFolders`.

## How it works

```
JavaScript
    │
    ▼  createNativeModule / useNativeModule
Backend
    ├── JSIBackend        on device, in-process
    └── NodeHostBackend   development, over stdio
    │
    ▼
CrossNative (C++)
    ├── ThreadPool        priority queue, one worker per core
    └── WasmRuntime       one wasm3 runtime per module
            │
            ▼
        compute.wasm
```

On device, the platform module reaches the JS runtime through the CallInvoker —
`RCTCallInvokerModule` on iOS, `ReactContext.getJSCallInvokerHolder()` on
Android — which doubles as the dispatcher that settles promises back on the JS
thread. That module is the only platform-specific code; the JSI layer and the
core below it are shared.

On the 32-bit Android ABIs (`armeabi-v7a`, `x86`) wasm3's guaranteed tail calls
cannot be compiled, so those builds fall back to ordinary calls and run slower.
`arm64-v8a` and `x86_64` are unaffected.

Each module gets its own wasm3 runtime, so modules are isolated and can run
concurrently. wasm3 runtimes are not thread-safe, so calls into a single module
are serialised by a per-module lock.

### Passing data

Numbers cross by value. Arrays have to be copied into the module's linear
memory, which requires the module to export `cn_alloc` and `cn_free`:

```typescript
import { inBuffer, outBuffer, inoutBuffer } from '@cross-native/core';

await compute.call('sum_array', [inBuffer([1, 2, 3]), 3]);          // read-only
await compute.call('matrix_multiply', [a, b, outBuffer(9), 3]);      // written by the module
await compute.call('process_dataset', [inoutBuffer(data), len]);     // mutated in place
```

Plain arrays and TypedArrays are converted to read-only input buffers
automatically. A call with a single output buffer returns that buffer directly.

### Plugins

```typescript
const compute = await createNativeModule({
  name: 'compute',
  source: './native/compute.rs',
  language: 'rust',
  plugins: [ConsolePlugin({ logArgs: true }), PerformancePlugin({ slowThresholdMs: 50 })],
});
```

---

## 📊 Performance

Measured on an Apple Silicon Mac by `npm run test:core`, comparing the wasm3
interpreter against Node's V8 JIT:

| Operation | JS (V8) | CrossNative (wasm3) | Ratio |
|-----------|---------|---------------------|-------|
| Matrix 120×120 | 3.5ms | 18.3ms | 5.3× slower |
| Process 200,000 items | 6.4ms | 182.0ms | 28.5× slower |
| Transfer 200,000 f64 (no real work) | 1.0ms | 32.9ms | 33.6× slower |
| Compute loop 2,000,000× | 42.0ms | 506.5ms | 12.1× slower |

**Read this table carefully — it does not say what you might expect.**

wasm3 is an *interpreter*. V8 is an optimising JIT. On raw numeric code V8 wins
by roughly an order of magnitude, and no amount of tuning changes that.
CrossNative does not make computation faster than JavaScript on a desktop.

Two things matter for the real target:

1. **React Native does not run V8.** It runs Hermes, which has no optimising JIT
   for numeric code and is far slower than V8 at exactly this kind of work. The
   on-device comparison is wasm3 vs Hermes, which is a different question — and
   one this project has not measured yet. Do not assume either direction.
2. **iOS forbids JIT** for third-party apps, so any WASM runtime on iOS is an
   interpreter or AoT-compiled. This is why wasm3 was chosen. Genuine native
   speed on iOS requires compiling Rust into the app binary at build time and
   calling it over FFI — a different architecture from loading WASM at runtime.

What CrossNative *does* deliver today is that **the work happens off the JS
thread**. The suite asserts this directly: the JS event loop ticked 1,080 times
during a 1,221ms native call. That is the property that keeps a UI at 60fps, and
it holds regardless of the throughput comparison.

The transfer row is worth noting too: moving 200,000 doubles costs ~33ms because
arguments are marshalled as JSON. For large arrays this dominates, and reducing
it is the most valuable open optimisation.

---

## Supported languages

| Language | Status |
|----------|--------|
| **Rust** | ✅ Working — verified end-to-end |
| **Go** (TinyGo) | 🔵 Planned |
| **C++** | 🟡 Partial — `SharedLibraryModule` loads a `.dylib`/`.so` exporting `crossnative_call`, untested |
| **Zig** | 🔵 Planned |

The runtime is not Rust-specific: any `wasm32` binary exporting `cn_alloc` and
`cn_free` will load today. What is missing for other languages is a compile step.

---

## Layout

```
packages/
├── core/                 TypeScript API
│   ├── src/api/          createNativeModule, useNativeModule
│   ├── src/bridge/       backends, argument marshalling
│   ├── src/plugins/      console, performance
│   └── test/             integration suite
└── native/         native core
    ├── cpp/              CrossNative, WasmRuntime, ThreadPool, NativeModule
    ├── jsi/              JSI binding, shared by both platforms
    ├── ios/              module that installs the proxy
    ├── android/          the same, plus JNI and the CMake build
    ├── wasm3/            vendored interpreter (see wasm3/VENDOR.md)
    ├── host/             stdio JSON host used by the Node backend
    └── test/             C++ suite and the Rust fixture
```

---

## What's next

1. **Measure against Hermes** — the open question. First data points for
   3,000,000 iterations of the compute loop: 10.4s on the iOS simulator and
   13.5s on the Android emulator, against 0.5s in Node. Both are Debug builds
   on emulated hardware, so neither is a fair number — but they do say the
   interpreter is the bottleneck, and a Release measurement on real devices,
   against Hermes rather than V8, is what should decide whether the WASM
   approach earns its place.
2. **Cheaper argument transfer** — replace JSON marshalling for large arrays.
3. **A CLI** — compiling `.rs` to `.wasm` is currently done by the Makefile.
4. **npm release.**

---

## License

Apache-2.0 — see [LICENSE](LICENSE). Vendored wasm3 is MIT; see
[packages/native/wasm3/VENDOR.md](packages/native/wasm3/VENDOR.md).
