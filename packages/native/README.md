# react-native-cross-native

Run compiled languages off the JavaScript thread in React Native.

React Native runs everything on one JS thread, so heavy work (matrix math, image
processing, crypto) freezes the UI. CrossNative lets you write that work in Rust,
Go, Zig, C, or C++, keep it in your project as a plain source file, and call it
from JS. It runs on a worker thread, so the UI stays responsive.

> Status: `0.1.0-alpha`. API and packaging are still settling.

## Install

```
npm install react-native-cross-native
cd ios && pod install && cd ..
```

## Quick start

Add the transformer and source extensions to `metro.config.js`:

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

Write a function (here in Rust, `compute.rs`):

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

Call it from JS — Metro compiles the source for you:

```ts
import {createNativeModule} from 'react-native-cross-native';
import WASM from './compute.rs';

const compute = await createNativeModule({
  name: 'compute',
  source: 'compute.rs',
  language: 'rust',
  bytes: WASM,
});

const result = await compute.call('heavy', [1_000_000]);
```

You'll need the compiler for your language on your PATH: Rust (`cargo` + the
`wasm32-unknown-unknown` target), Go 1.24+, or a single `zig` binary (which
covers Zig, C, and C++). Run `npx cross-native doctor` to check.

## Documentation

Full step-by-step guide, including native speed on Android (AOT) and iOS (linked
static libraries): **https://github.com/melodyLeonard/cross-native/blob/main/docs/getting-started.md**

## License

Apache-2.0
