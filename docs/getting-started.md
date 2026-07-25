# Getting started

CrossNative lets you write a compute function in a compiled language, keep it in
your React Native project as a plain source file, and call it from JS. The work
runs on a worker thread, so it doesn't block the UI.

## 1. Install

```
npm install react-native-cross-native
cd ios && pod install   # Android links automatically
```

## 2. Point Metro at the transformer

Metro compiles your source files on demand. Add the transformer and the source
extensions to `metro.config.js`:

```js
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-cross-native/metro-transformer',
    ),
  },
  resolver: {
    sourceExts: [
      ...defaultConfig.resolver.sourceExts,
      'rs', 'go', 'zig', 'c', 'cc', 'cpp', 'cxx',
    ],
  },
});
```

## 3. Install the toolchain for your language

CrossNative shells out to the real compiler, so you need it on your PATH:

| Language | Toolchain |
|----------|-----------|
| Rust | `rustup target add wasm32-unknown-unknown` |
| Go | Go 1.24 or newer |
| Zig | The `zig` binary (also covers C and C++) |
| C, C++ | The `zig` binary |

Point CrossNative at a specific binary with `CROSSNATIVE_ZIG` / `CROSSNATIVE_GO`
if it isn't on your PATH. Run `npx cross-native doctor` to see what's detected.

## 4. Write your function

Each language marks the functions it wants to expose to JS. Put each module in
its own folder.

**Rust** — `native/compute.rs`

```rust
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

**Go** — `native/compute.go`

```go
package main

//go:wasmexport heavy
func heavy(iterations int32) float64 {
    var sum float64
    for i := int32(0); i < iterations; i++ {
        sum += float64(i)
    }
    return sum
}

func main() {}
```

**Zig** — `native/compute.zig`

```zig
export fn heavy(iterations: u32) f64 {
    var sum: f64 = 0;
    var i: u32 = 0;
    while (i < iterations) : (i += 1) sum += @floatFromInt(i);
    return sum;
}
```

**C** — `native/compute.c`

```c
#include <stdint.h>

__attribute__((export_name("heavy")))
double heavy(uint32_t iterations) {
    double sum = 0;
    for (uint32_t i = 0; i < iterations; i++) sum += i;
    return sum;
}
```

**C++** — `native/compute.cpp` — same as C, wrapped in `extern "C" { ... }`.

Supported parameter and return types: the numeric primitives, `bool`, and (for
Rust) `Vec<number>`, `&[number]`, `String`, `&str`.

## 5. Call it from JS

```ts
import {createNativeModule} from 'react-native-cross-native';
import WASM from './native/compute.rs'; // Metro compiles this to bytes

const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.rs',
  language: 'rust',
  bytes: WASM,
});

const result = await compute.call('heavy', [1_000_000]);
```

Swap the import and `language` for `.go`, `.zig`, `.c`, or `.cpp`.

## Speed: AOT and iOS

By default modules run on the WebAssembly interpreter, which works everywhere but
is slower than JS on raw number crunching. To get native speed:

- **Android** loads AOT-compiled WebAssembly at runtime. Run Metro with
  `CROSSNATIVE_AOT=1` (and `CROSSNATIVE_WAMRC` pointing at a `wamrc` binary) and
  the modules are compiled ahead of time.
- **iOS** does not allow loading code at runtime, so a language is either
  compiled into the app as a static library and called over the C ABI, or it
  falls back to the interpreter. Build a static library with
  `cross-native build-native`, add it to your Podfile with `-force_load`, and
  pass `linked: true` (with `linkedSymbol` for non-Rust languages) to
  `createNativeModule`. See the example app for a full setup.

## Passing arrays

Numbers cross by value. Arrays are copied into the module's memory, which needs
the module to export `cn_alloc`/`cn_free`:

```ts
import {inBuffer, outBuffer} from '@cross-native/core';

await compute.call('sum', [inBuffer([1, 2, 3]), 3]);
await compute.call('multiply', [a, b, outBuffer(9), 3]);
```
