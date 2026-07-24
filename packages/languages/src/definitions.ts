/**
 * The language table.
 *
 * Adding a language means adding an entry here and a compile driver in
 * @cross-native/compiler — nothing else in the codebase should need to learn
 * a new name.
 */

import type { LanguageDefinition } from './types.ts';

/** Rust needs the wasm32 target, which rustup can add to an existing install. */
const WASM_TARGET_HINT =
  'CrossNative compiles to WebAssembly, which needs the wasm32-unknown-unknown target.';

export const LANGUAGES: readonly LanguageDefinition[] = [
  {
    id: 'rust',
    displayName: 'Rust',
    extensions: ['.rs'],
    support: 'stable',
    artifact: 'wasm',
    toolchain: [
      {
        id: 'cargo',
        label: 'Cargo',
        probe: ['cargo', '--version'],
        installUrl: 'https://rustup.rs',
        installHint: 'Install Rust from https://rustup.rs',
      },
      {
        id: 'wasm32-unknown-unknown',
        label: 'Rust wasm32 target',
        probe: ['rustup', 'target', 'list', '--installed'],
        installUrl: 'https://rustup.rs',
        installHint: `${WASM_TARGET_HINT} Add it with: rustup target add wasm32-unknown-unknown`,
        autoFix: {
          command: ['rustup', 'target', 'add', 'wasm32-unknown-unknown'],
          describes: 'add the wasm32-unknown-unknown target to your Rust toolchain',
        },
      },
    ],
  },
  {
    id: 'go',
    displayName: 'Go',
    extensions: ['.go'],
    support: 'experimental',
    artifact: 'wasm',
    // Plain Go (no TinyGo): `GOOS=wasip1 GOARCH=wasm go build`. Needs a Go with
    // the //go:wasmexport directive — 1.24+. CROSSNATIVE_GO overrides the binary.
    toolchain: [
      {
        id: 'go',
        label: 'Go (1.24+)',
        probe: [process.env.CROSSNATIVE_GO ?? 'go', 'version'],
        installUrl: 'https://go.dev/dl/',
        installHint: 'Install Go 1.24+ from https://go.dev/dl/, or set CROSSNATIVE_GO',
      },
    ],
  },
  {
    id: 'zig',
    displayName: 'Zig',
    extensions: ['.zig'],
    support: 'experimental',
    artifact: 'wasm',
    toolchain: [
      {
        id: 'zig',
        label: 'Zig',
        // CROSSNATIVE_ZIG overrides the binary, mirroring how the Rust driver
        // finds wamrc — so a project can point at a vendored toolchain without a
        // system-wide install.
        probe: [process.env.CROSSNATIVE_ZIG ?? 'zig', 'version'],
        installUrl: 'https://ziglang.org/download/',
        installHint: 'Install Zig from https://ziglang.org/download/, ' +
          'or set CROSSNATIVE_ZIG to a Zig binary',
      },
    ],
  },
  {
    id: 'assemblyscript',
    displayName: 'AssemblyScript',
    extensions: ['.as.ts'],
    support: 'planned',
    artifact: 'wasm',
    toolchain: [
      {
        id: 'asc',
        label: 'AssemblyScript compiler',
        probe: ['npx', 'asc', '--version'],
        installUrl: 'https://www.assemblyscript.org/introduction.html',
        installHint: 'Install with: npm install --save-dev assemblyscript',
      },
    ],
    notReadyReason:
      'AssemblyScript has no CrossNative compile step yet.\n' +
      'Workaround: compile to WebAssembly yourself and pass the bytes directly.',
  },
  {
    id: 'c',
    displayName: 'C',
    extensions: ['.c'],
    support: 'experimental',
    artifact: 'wasm',
    // C is compiled by Zig's bundled clang (`zig cc`), so it shares the Zig
    // toolchain — no separate wasi-sdk or emscripten install.
    toolchain: [
      {
        id: 'zig',
        label: 'Zig (clang)',
        probe: [process.env.CROSSNATIVE_ZIG ?? 'zig', 'version'],
        installUrl: 'https://ziglang.org/download/',
        installHint: 'Install Zig from https://ziglang.org/download/ ' +
          '(it bundles clang for C), or set CROSSNATIVE_ZIG',
      },
    ],
  },
  {
    id: 'cpp',
    displayName: 'C++',
    extensions: ['.cc', '.cpp', '.cxx'],
    support: 'experimental',
    artifact: 'wasm',
    // Same story as C: `zig c++` gives a WASI-reactor wasm with libc++ linked.
    toolchain: [
      {
        id: 'zig',
        label: 'Zig (clang++)',
        probe: [process.env.CROSSNATIVE_ZIG ?? 'zig', 'version'],
        installUrl: 'https://ziglang.org/download/',
        installHint: 'Install Zig from https://ziglang.org/download/ ' +
          '(it bundles clang++ for C++), or set CROSSNATIVE_ZIG',
      },
    ],
  },
];
