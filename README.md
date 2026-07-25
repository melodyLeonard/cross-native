# CrossNative

[![CI](https://github.com/melodyLeonard/cross-native/actions/workflows/ci.yml/badge.svg)](https://github.com/melodyLeonard/cross-native/actions/workflows/ci.yml)

Run compiled languages off the JavaScript thread in React Native.

React Native runs everything on one JS thread, so heavy work (matrix math, image
processing, crypto) freezes the UI. CrossNative lets you write that work in Rust,
Go, Zig, C, or C++, keep it in your project as a plain source file, and call it
from JS. It runs on a worker thread, so the UI stays responsive.

> Status: `0.1.0-alpha.1`. The API and packaging are still settling.

```rust
// compute.rs
use crossnative::crossnative;

#[crossnative]
pub fn heavy(iterations: u32) -> f64 {
    let mut sum = 0.0;
    for i in 0..iterations {
        sum += (i as f64).sqrt();
    }
    sum
}
```

```typescript
import { createNativeModule } from 'react-native-cross-native';
import WASM from './compute.rs'; // Metro compiles this for you

const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.rs',
  language: 'rust',
  bytes: WASM,
});

const result = await compute.call('heavy', [1_000_000]);
```

Metro compiles the source on demand through `@melodyleonard/compiler`, so you
never run cargo, zig, or go by hand.

**New here?** Follow the [getting-started guide](docs/getting-started.md) — a
step-by-step walkthrough for every language, from install to running on device.

## Supported languages

| Language | Toolchain |
|----------|-----------|
| Rust | `cargo` + the `wasm32-unknown-unknown` target |
| Go   | `go` 1.24+ (uses `//go:wasmexport`, no TinyGo) |
| Zig  | `zig` |
| C    | `zig cc` |
| C++  | `zig c++` |

One `zig` binary covers Zig, C, and C++. Adding a language is a compile driver in
`packages/compiler/src/drivers` plus a registry entry in `packages/languages`;
the runtime itself is not language-specific.

## Performance

Every language runs at native speed on both platforms, off the JS thread. These
are on-device numbers for a 100-million-iteration Monte Carlo loop (every
language computes the identical result):

| Language | Android (AOT) | iOS (native FFI) |
|----------|---------------|------------------|
| Rust | 133ms | 218ms |
| Go   | 134ms | 121ms |
| Zig  | 134ms | 203ms |
| C    | 120ms | 204ms |
| C++  | 130ms | 202ms |
| JavaScript (Hermes) | 18,426ms | 10,897ms |

The same work in JavaScript takes 10–18 **seconds** and freezes the UI the whole
time; the native versions finish in a fifth of a second and the UI keeps
animating.

## How each platform runs it

The runtime takes the fastest path the OS allows, all from the same source file:

- **Android** allows loading executable code at runtime, so it loads
  AOT-compiled WebAssembly (`.aot`) — native machine code.
- **iOS** forbids loading code at runtime, so each language is compiled into the
  app as a static library and called over the C ABI. Rust, Zig, C, and C++ build
  a small static library; Go builds a c-archive (the Go runtime linked in).
- **The WebAssembly interpreter** is the universal fallback and works everywhere
  with no toolchain beyond the source compiler.

## Architecture

```
JavaScript
  │  createNativeModule / useNativeModule
Backend (JSI on device, Node host in dev)
  │
CrossNative (C++)
  ├── ThreadPool     one worker per core
  └── WasmRuntime    WAMR, one runtime per module
```

On device the platform module reaches the JS runtime through the CallInvoker
(`RCTCallInvokerModule` on iOS, `getJSCallInvokerHolder()` on Android), which
settles promises back on the JS thread. That module is the only
platform-specific code; the JSI layer and everything below it are shared.

Numbers cross by value. Arrays are copied into the module's linear memory, which
needs the module to export `cn_alloc`/`cn_free`:

```typescript
import { inBuffer, outBuffer } from '@melodyleonard/core';

await compute.call('sum_array', [inBuffer([1, 2, 3]), 3]);
await compute.call('matrix_multiply', [a, b, outBuffer(9), 3]);
```

## Layout

```
packages/
├── core/        TypeScript API (createNativeModule, backends, marshalling)
├── compiler/    per-language compile drivers + the cross-native CLI
├── languages/   the language registry
└── native/      C++ core (WAMR runtime, thread pool), JSI binding, iOS/Android
```

## License

Apache-2.0. See [LICENSE](LICENSE).
