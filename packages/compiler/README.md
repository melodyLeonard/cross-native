# @cross-native/compiler

The toolchain layer for [CrossNative](https://github.com/melodyLeonard/cross-native).
It turns a source file in a supported language into a loadable WebAssembly (or
native) artifact, and tells you clearly when the compiler for that language
isn't installed.

Most people never install this directly — `react-native-cross-native` depends on
it and its Metro transformer calls it for you. Reach for it when you want to
compile outside of Metro: a CLI check, a build script, or your own tooling.

```
npm install @cross-native/compiler
```

Supported languages: Rust, Go, Zig, C, C++. Each needs its own compiler on your
PATH (`cargo`, `go`, or a single `zig` binary for Zig/C/C++).

## CLI

The package ships a `cross-native` binary.

```bash
# Compile ./native (or a given directory) and print the embedded module
npx cross-native build ./native --language rust --entry compute.rs --stdout

# Report which language toolchains are usable on this machine
npx cross-native doctor

# Build a static library for the iOS linked path (Zig, C, C++, Go)
npx cross-native build-native ./native \
  --language zig --entry compute.zig \
  --symbol _zig --target aarch64-ios-simulator \
  --out ./ios/libcompute_zig.a
```

Flags for `build`:

| Flag | Meaning |
| --- | --- |
| `--language <id>` | Override the language inferred from the file extension |
| `--entry <file>` | The source file to compile (relative to the directory) |
| `--out <path>` | Where to write the embedded module |
| `--stdout` | Print the base64 module to stdout instead of a file |
| `--aot` | Also produce a native `.aot` (needs `wamrc`; see below) |
| `--fix` | Run safe toolchain fixes, e.g. adding the `wasm32` target |

## Programmatic API

```ts
import {compile, toBase64, inspectToolchain} from '@cross-native/compiler';

// Is the Rust toolchain ready?
const report = await inspectToolchain('rust');
if (!report.ready) throw new Error('install the Rust toolchain first');

// Compile a source file to a .wasm artifact
const result = await compile({
  sourceDir: './native',
  entryFile: 'compute.rs',
  language: 'rust',
});
if (!result.ok) throw new Error(result.error);

const base64 = await toBase64(result.artifactPath);
```

Also exported: `compileAot` / `resolveWamrc` (ahead-of-time compilation for
Android native speed), `embedWasm`, `describeMissing`, `applyFixes`, and the
iOS native-library builders `compileZigNativeLib` / `compileClangNativeLib` /
`compileGoNativeLib`.

## Ahead-of-time compilation

`compile` produces a portable `.wasm` that CrossNative's runtime interprets. For
native speed on Android, compile that to a `.aot` with `wamrc` (the WebAssembly
Micro Runtime's AOT compiler). Point the tooling at it and enable AOT:

```
CROSSNATIVE_AOT=1 CROSSNATIVE_WAMRC=/path/to/wamrc npx cross-native build ./native --aot
```

On a real device this is the difference between roughly 10 seconds and 200
milliseconds for the same heavy loop. See the
[getting-started guide](https://github.com/melodyLeonard/cross-native/blob/main/docs/getting-started.md)
for building `wamrc` and the full iOS/Android story.

## License

Apache-2.0
