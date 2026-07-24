# Node demo

Runs the CrossNative TypeScript API against the real C++ core on your machine —
no React Native build required. This is the fastest way to verify a change to
the runtime, the bridge, or a native module.

## Run it

```bash
make -C packages/nitro-module crossnative-host wasm
node --experimental-strip-types examples/node-demo/demo.ts
```

No `npm install` needed. The core has no runtime dependencies and is written in
type-strippable TypeScript, so Node runs it directly from source.

## What it checks

- Loading a Rust-compiled `.wasm` and enumerating its exports
- Scalar calls (`add`, `factorial`)
- Array arguments: plain arrays, `Float64Array`, `inoutBuffer`, `outBuffer`
- Results agreeing with equivalent JavaScript, element by element
- Errors rejecting rather than returning wrong answers
- The JS event loop staying responsive during a long native call
- A JS-vs-wasm3 benchmark, including transfer cost measured on its own

## How it reaches the native code

```
demo.ts
  └── @cross-native/core  (createNativeModule)
        └── NodeHostBackend        line-delimited JSON over stdio
              └── crossnative-host        C++ binary
                    └── CrossNative       thread pool
                          └── WasmRuntime → wasm3 → compute.wasm
```

On a device the `NodeHostBackend` is replaced by the JSI backend and the process
boundary disappears, but everything below it is the same code.

## Reading the benchmark

The demo compares wasm3 against V8, and V8 wins on raw compute — wasm3 is an
interpreter. That comparison is not the one that matters for React Native, which
runs Hermes rather than V8. See the Performance section in the top-level
[README](../../README.md) before drawing conclusions from these numbers.

The `Transfer` row isolates marshalling cost: `sum_array` over 200,000 doubles
does almost no arithmetic, so its time is essentially the cost of moving the
array across the bridge. Part of that is JSON encoding, and part is this demo's
stdio pipe, which the on-device JSI path does not have.
