# react-native-cross-native

Run compiled languages off the JavaScript thread in React Native.

React Native runs everything on one JS thread, so heavy work (matrix math, image
processing, crypto, simulation) freezes the UI. CrossNative lets you write that
work in **Rust, Go, Zig, C, or C++**, keep it in your project as a plain source
file, and call it from JS. It runs on a worker thread, so the UI stays
responsive — and it's dramatically faster than the same code in JavaScript.

> `0.1.0` — first stable release.

## Benchmark

The same Monte Carlo π estimate (100 million iterations, an identical LCG in
every language) run from one React Native app. Native languages run off the JS
thread; JavaScript runs on it and freezes the UI while it works.

<table>
<tr>
<td align="center"><b>iOS</b> — native static-lib linking</td>
<td align="center"><b>Android</b> — ahead-of-time (AOT) compiled</td>
</tr>
<tr>
<td><img src="https://raw.githubusercontent.com/melodyLeonard/cross-native/main/docs/images/bench-ios.png" width="330" alt="iOS benchmark"></td>
<td><img src="https://raw.githubusercontent.com/melodyLeonard/cross-native/main/docs/images/bench-android.png" width="330" alt="Android benchmark"></td>
</tr>
</table>

Every language returns the same answer (π ≈ 3.14189). The native languages finish
in **~120–220 ms**; the identical algorithm in JavaScript (Hermes) takes
**11–17 seconds** — roughly **50–130× slower** — and blocks the UI thread the
whole time, while the native runs keep it live.

## How it works

1. **Compile on bundle.** The Metro transformer sees an `import x from './f.rs'`,
   runs the real compiler (`cargo`/`go`/`zig`) once, and hands your JS a compiled
   WebAssembly module — you never run a toolchain by hand.
2. **Run off the JS thread.** A JSI native module executes the module on a worker
   thread pool (WebAssembly Micro Runtime), so a long call never blocks the UI.
3. **Native speed on device.** By default your module runs on a small, portable
   WebAssembly interpreter — it works everywhere and is fine for moderate work,
   but it's slower than real machine code. To reach full speed the module has to
   become native machine code for the device, and *how* that happens differs by
   platform, because the two operating systems have different rules:
   - **Android** lets an app run code that was compiled after the app shipped, so
     CrossNative compiles your module **ahead of time (AOT)** into native code the
     device runs directly.
   - **iOS** does not allow an app to generate machine code at runtime, so instead
     your module is compiled into the app as a **static library** at build time
     and called directly.

   Both reach the same native speed — the step-by-step for each is in the two
   platform guides below.

## Setup (both platforms)

These four steps get a module running off the JS thread on either platform.

**1. Install**

```
npm install react-native-cross-native
cd ios && pod install && cd ..     # iOS only
```

One package is all you need — it pulls in the compiler and core automatically.

**2. Configure Metro** — add the transformer and source extensions to
`metro.config.js`:

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

**3. Install your language's toolchain** — CrossNative calls the real compiler,
so it must be on your PATH. Install only what you need, then check with
`npx cross-native doctor`:

- **Rust** — `rustup` + `rustup target add wasm32-unknown-unknown`
- **Go** — Go 1.24+
- **Zig / C / C++** — one `zig` binary on your PATH (it compiles all three)

**4. Write a function and call it** — here in Rust, `native/compute.rs`:

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

> **Important:** This already runs on a background thread, on a portable
> interpreter. For heavy number-crunching, follow your platform below to get
> native speed.

## Getting started on iOS

iOS does not allow generating machine code at runtime, so for native speed you
compile your module into the app as a **static library** and call it directly.
After the shared setup above:

**1. Build the static library.** For Zig, C, C++, or Go:

```
npx cross-native build-native native \
  --language zig --entry compute.zig \
  --symbol _zig --target aarch64-ios-simulator \
  --out native/ios/libcompute_zig.a
```

Use `--target aarch64-ios-simulator` for the simulator and `aarch64-ios` for a
device. Each language has its own entry-symbol suffix: Rust `''` (empty), Zig
`_zig`, C `_c`, C++ `_cpp`, Go `_go`. For **Rust**, build a `staticlib` crate
instead:

```
cargo build --target aarch64-apple-ios-sim --release   # or aarch64-apple-ios
```

**2. Force-load the library** in your `ios/Podfile` `post_install` block, so its
entry symbols survive linking:

```ruby
flag = '-force_load $(PODS_ROOT)/../native/ios/libcompute_zig.a'
# add `flag` to OTHER_LDFLAGS on your app target
```

Run `cd ios && pod install` again after editing the Podfile.

**3. Tell `createNativeModule` to use the linked code** — pass `linked: true` and
the matching symbol suffix instead of `bytes`:

```ts
const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.zig',
  language: 'zig',
  linked: true,
  linkedSymbol: '_zig', // Rust uses '' (empty)
});
```

Rebuild the app (`npx react-native run-ios`). The call now runs as native code.

## Getting started on Android

Android **can** load compiled machine code at runtime, so for native speed you
compile your module ahead-of-time (AOT) with `wamrc`. After the shared setup
above:

**1. Get `wamrc`** — the ahead-of-time compiler from the WebAssembly Micro
Runtime. It's a large LLVM-based tool, so it isn't bundled; build it once:

```
git clone https://github.com/bytecodealliance/wasm-micro-runtime
cd wasm-micro-runtime/wamr-compiler
./build_llvm.sh          # one-time, slow
mkdir build && cd build && cmake .. && make
# the binary is now ./wamrc
```

**2. Start Metro with AOT enabled** — point CrossNative at `wamrc` and turn AOT
on:

```
CROSSNATIVE_AOT=1 CROSSNATIVE_WAMRC=/absolute/path/to/wamrc npm start
```

The transformer now compiles each module to native `.aot` code. You'll see
`aot  .../compute.aot` lines in the Metro output. Rebuild the app
(`npx react-native run-android`) and every language runs at native speed —
typically tens of milliseconds where the interpreter took seconds.

> **Architecture note.** An `.aot` file is native code for one CPU architecture.
> CrossNative builds it for `arm64` (aarch64), which covers real devices and
> Apple-silicon emulators; on an x86_64 device or emulator the runtime falls back
> to the interpreter for that module. If `CROSSNATIVE_WAMRC` is unset, CrossNative
> logs a note and ships the interpreter `.wasm` rather than failing the build.

## Passing arrays

Numbers and booleans cross by value. Arrays are copied into the module's memory
with the buffer helpers:

```ts
import {inBuffer, outBuffer} from 'react-native-cross-native';

await compute.call('sum', [inBuffer([1, 2, 3]), 3]);        // module reads
await compute.call('scale', [outBuffer(9), 9]);             // module writes
```

## Packages

CrossNative is a small monorepo. Installing `react-native-cross-native` brings in
the rest:

| Package | Role |
| --- | --- |
| **react-native-cross-native** | The React Native package: JSI native module, WASM runtime, and the Metro transformer |
| **@cross-native/compiler** | The `cross-native` CLI and the per-language compile drivers |
| **@cross-native/core** | The runtime and JS API (`createNativeModule`, buffers, plugins) |
| **@cross-native/languages** | The language registry and validation |

## Documentation

The full guide — every language, argument marshalling, and troubleshooting —
lives in
[docs/getting-started.md](https://github.com/melodyLeonard/cross-native/blob/main/docs/getting-started.md).

## License

Apache-2.0
