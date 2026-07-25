# @cross-native/core

The runtime and JavaScript API for [CrossNative](https://github.com/melodyLeonard/cross-native).
It loads a compiled module (Rust, Go, Zig, C, or C++) and lets you call its
functions from JavaScript — the work runs off the JS thread, so the UI stays
responsive.

This is the platform-agnostic core. In a React Native app you normally install
`react-native-cross-native`, which wires this up to the native runtime and
re-exports everything here. Use `@cross-native/core` directly for tests, Node
tooling, or a non-RN host.

```
npm install @cross-native/core
```

## Loading a module

`createNativeModule` returns a handle whose `call` runs a function by name, and
whose `fns` exposes the module's exported functions directly (snake_case and
camelCase both work):

```ts
import {createNativeModule, outBuffer} from '@cross-native/core';
import WASM from './compute.rs'; // base64 module (Metro compiles this in RN)

const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.rs',
  language: 'rust',
  bytes: WASM,
});

const sum = await compute.call('add', [1.5, 2.5]); // 4
const matrix = await compute.fns.matrixMultiply(a, b, outBuffer(n * n), n);

compute.dispose();
```

In React (React Native) there's a hook:

```ts
import {useNativeModule} from '@cross-native/core';

const {fns, ready} = useNativeModule({name: 'compute', source: 'compute.rs', language: 'rust', bytes: WASM});
```

## Passing arrays

Numbers and booleans cross by value. Arrays are copied into the module's memory
with the buffer helpers:

```ts
import {inBuffer, outBuffer, inoutBuffer} from '@cross-native/core';

await compute.call('sum', [inBuffer([1, 2, 3]), 3]);        // module reads
await compute.call('scale', [outBuffer(9), 9]);             // module writes
await compute.call('normalize', [inoutBuffer(data), data.length]); // both
```

## What's exported

- **Loading:** `createNativeModule`, `useNativeModule`, `withPlugins`
- **Arrays:** `inBuffer`, `outBuffer`, `inoutBuffer`, `isBufferArg`, `normalizeArg`
- **Bridge internals:** `NativeBridge`, `JSIBackend`, `registerJSIInstaller`, `isJSIAvailable`, `buildCallables`
- **Environment:** `isNativeAvailable`, `getRuntimeInfo`
- **Plugins:** `createPlugin`, `composePlugins`, `ConsolePlugin`, `PerformancePlugin`
- **Errors:** `NativeError`, `NativeTimeoutError`
- **Types:** `NativeModule`, `NativeModuleConfig`, `NativeFunction`, `NativeArg`, `FunctionSignature`, `CallOptions`, `Plugin`, and more

Full types ship with the package, so editors give you completion and checking on
all of the above.

## License

Apache-2.0
