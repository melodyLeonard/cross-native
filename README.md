# CrossNative

Run compiled languages off the JavaScript thread in React Native.

React Native runs everything on one JS thread, so heavy work (matrix math, image
processing, crypto) freezes the UI. CrossNative lets you write that work in Rust,
Go, Zig, C or C++, keep it in your project as a plain source file, and call it
from JS. It runs on a worker thread, so the UI stays responsive.

```rust
// compute.rs
use crossnative::crossnative;

#[crossnative]
pub fn benchmark_heavy(iterations: u32) -> f64 {
    let mut sum = 0.0;
    for i in 0..iterations {
        let x = ((i % 6283) as f64) * 0.001;
        sum += x.sqrt().sin() * x.cos();
    }
    sum
}
```

```typescript
import { createNativeModule } from 'react-native-cross-native';

const compute = await createNativeModule({
  name: 'compute',
  source: './compute.rs',
  language: 'rust',
});

const result = await compute.call('benchmark_heavy', [3_000_000]);
```

Metro compiles the source on demand through `@cross-native/compiler`, so you
never run cargo/zig/go by hand.

## Supported languages

| Language | Toolchain |
|----------|-----------|
| Rust | `cargo` + the `wasm32-unknown-unknown` target |
| Go | `go` 1.24+ (uses `//go:wasmexport`, no TinyGo) |
| Zig | `zig` |
| C | `zig cc` |
| C++ | `zig c++` |

One `zig` binary covers Zig, C and C++. Adding a language is a compile driver in
`packages/compiler/src/drivers` plus a registry entry in `packages/languages`;
the runtime isn't language-specific.

## How each platform runs it

The runtime picks the fastest path the OS allows:

- **Android** loads AOT-compiled WASM at runtime. Every language beats JS.
- **iOS** forbids loading executable code at runtime, so languages are either
  compiled into the app as a static library and called over the C ABI (Rust and
  Zig today), or run on the WASM interpreter as a fallback.
- The interpreter is the portable path and works everywhere.

Same 3,000,000-iteration float loop, measured on device:

| Language | Android (AOT) | iOS (linked) | iOS (interpreter) |
|----------|---------------|--------------|-------------------|
| Rust | 50ms | 22ms | — |
| Zig  | 37ms | 21ms | ~4,900ms |
| C    | 32ms | — | ~4,850ms |
| C++  | 32ms | — | ~4,870ms |
| Go   | 72ms | — | ~6,400ms |
| JS (Hermes) | 176ms | 189ms | 189ms |

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
import { inBuffer, outBuffer } from '@cross-native/core';

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
