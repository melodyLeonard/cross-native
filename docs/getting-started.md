# Getting started

This guide assumes you have never used CrossNative before. Follow it top to
bottom and you'll have a compiled function running off the JavaScript thread.

## What this does

React Native runs all your JavaScript on one thread. A heavy loop (image
processing, physics, crypto, big data) blocks that thread and the UI freezes.
CrossNative lets you write that loop in Rust, Go, Zig, C, or C++, keep it in your
project as a normal source file, and call it from JS. It runs on a background
thread, so the UI stays smooth.

You write the source. CrossNative compiles it for you. You never touch cargo,
zig, or go on the command line.

## Prerequisites

- **Node 22.6 or newer** (`node --version`). CrossNative runs its TypeScript
  through Node's type stripping, which needs 22.6+.
- A working React Native project (this guide assumes RN 0.76+).
- Xcode (for iOS) and/or Android Studio (for Android), as usual for React Native.

## Step 1 — Install the package

```
npm install react-native-cross-native
cd ios && pod install && cd ..
```

Android links automatically; no extra step.

## Step 2 — Tell Metro how to compile your source files

Open `metro.config.js` and add the transformer and the file extensions. If your
file is minimal, replace it with this:

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

Restart Metro after changing this file (`npm start -- --reset-cache`).

## Step 3 — Install the compiler for your language

CrossNative calls the real compiler under the hood, so it has to be on your
machine. Install only the one(s) you need:

- **Rust**
  ```
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add wasm32-unknown-unknown
  ```
- **Go** — install Go 1.24 or newer from https://go.dev/dl/.
- **Zig, C, or C++** — download a single Zig binary from
  https://ziglang.org/download/ and either put it on your PATH or set
  `CROSSNATIVE_ZIG=/path/to/zig`. That one binary compiles Zig, C, and C++.

Check what CrossNative can see:

```
npx cross-native doctor
```

It prints each language and whether its toolchain is ready.

## Step 4 — Write your function

Put each module in its own folder. Mark the functions you want to reach from JS.
Here is the same simple example in each language.

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

**C++** — `native/compute.cpp` — the same as C, wrapped in `extern "C" { ... }`.

Supported types: the numeric primitives and `bool`. Rust additionally supports
`Vec<number>`, `&[number]`, `String`, and `&str`.

## Step 5 — Call it from JavaScript

```ts
import {createNativeModule} from 'react-native-cross-native';
import WASM from './native/compute.rs'; // Metro compiles this for you

const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.rs',
  language: 'rust',
  bytes: WASM,
});

const result = await compute.call('heavy', [1_000_000]);
```

For another language, change the import path, the `source`, and the `language`
(`'go'`, `'zig'`, `'c'`, `'cpp'`). That's it — run your app and the call happens
on a background thread.

## Step 6 — Getting native speed

By default your module runs on a small WebAssembly interpreter. It works
everywhere and is fine for moderate work, but on heavy number crunching it is
slower than JavaScript. The two ways to get real native speed:

### Android — ahead-of-time compilation

**What "AOT" means here.** By default your compiled function is shipped as a
`.wasm` file and executed by an interpreter — a program that reads one
WebAssembly instruction at a time. That is portable but slow. Ahead-of-time
(AOT) compilation instead turns the `.wasm` into real machine code for the
device *before* it ships, and the runtime just loads and runs it. Android
permits an app to load executable code at runtime, so this is allowed there (iOS
does not — see the next section).

**The tool: `wamrc`.** The conversion from `.wasm` to native code is done by
`wamrc`, the ahead-of-time compiler that ships with the WebAssembly Micro
Runtime (WAMR), the same runtime CrossNative embeds. It is a large LLVM-based
binary, so it is not bundled in the npm package. You get it by building WAMR's
compiler once:

```
git clone https://github.com/bytecodealliance/wasm-micro-runtime
cd wasm-micro-runtime/wamr-compiler
./build_llvm.sh        # one-time, downloads/builds LLVM (slow)
mkdir build && cd build && cmake .. && make
# the binary is now ./wamrc
```

**Turning it on.** Point CrossNative at that binary and enable AOT when you start
Metro:

```
CROSSNATIVE_AOT=1 CROSSNATIVE_WAMRC=/absolute/path/to/wamrc npm start
```

- `CROSSNATIVE_AOT=1` tells the Metro transformer to run `wamrc` after compiling
  your source, so the bundle carries a native `.aot` module instead of a `.wasm`
  one.
- `CROSSNATIVE_WAMRC` is the absolute path to the `wamrc` binary above. If it is
  unset, CrossNative logs a note and falls back to the interpreter `.wasm`
  rather than failing the build.

You'll see lines like `aot  .../compute.aot` in the Metro output when it worked.
With AOT on, every language runs at native speed on Android — typically tens of
milliseconds where the interpreter took seconds.

**Note on architecture.** An `.aot` file is native code for one CPU
architecture. CrossNative builds it for `aarch64` (arm64), which covers modern
devices and Apple-silicon emulators. On a non-arm64 device the runtime falls
back to the interpreter for that module.

### iOS — link the code into the app

iOS does not allow loading compiled code at runtime, so on iOS a language is
either interpreted, or compiled into the app as a static library and called
directly. All five languages support this — Rust, Zig, C and C++ build a small
static library; Go builds a c-archive (which bundles the Go runtime). To link
one in:

1. Build the static library:
   ```
   npx cross-native build-native native \
     --language zig --entry compute.zig \
     --symbol _zig --target aarch64-ios-simulator \
     --out native/ios/libcompute_zig.a
   ```
   (Rust builds with `cargo build --target aarch64-apple-ios-sim --release` from
   a crate whose `crate-type` includes `staticlib`.)
2. Force-load it in your `ios/Podfile` `post_install` block:
   ```ruby
   flag = '-force_load $(PODS_ROOT)/../native/ios/libcompute_zig.a'
   ```
3. Tell `createNativeModule` to use the linked code:
   ```ts
   await createNativeModule({
     name: 'compute',
     source: 'compute.zig',
     language: 'zig',
     linked: true,
     linkedSymbol: '_zig', // Rust uses '' (empty); each language its own suffix
   });
   ```

Use `aarch64-ios-simulator` for the simulator and `aarch64-ios` for a device.
The example app in this repo (`PiBench`) shows a complete iOS + Android setup
across all five languages.

## Passing arrays

Numbers cross by value. Arrays are copied into the module's memory, which needs
the module to export `cn_alloc`/`cn_free`:

```ts
import {inBuffer, outBuffer} from '@melodyleonard/core';

await compute.call('sum', [inBuffer([1, 2, 3]), 3]);       // read-only input
await compute.call('multiply', [a, b, outBuffer(9), 3]);   // module writes output
```

## Troubleshooting

- **"toolchain not found"** — install the compiler from Step 3, or set the
  `CROSSNATIVE_ZIG` / `CROSSNATIVE_GO` environment variable, then rerun
  `npx cross-native doctor`.
- **A change to your source isn't picked up** — restart Metro with
  `--reset-cache`.
- **It's slower than expected** — you're on the interpreter. Turn on AOT
  (Android) or link the library (iOS) as in Step 6.
