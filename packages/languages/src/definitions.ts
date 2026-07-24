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
    support: 'planned',
    artifact: 'wasm',
    toolchain: [
      {
        id: 'tinygo',
        label: 'TinyGo',
        probe: ['tinygo', 'version'],
        installUrl: 'https://tinygo.org/getting-started/install/',
        installHint: 'Install TinyGo from https://tinygo.org/getting-started/install/',
      },
    ],
    notReadyReason:
      'The runtime already loads any .wasm binary, but CrossNative has no TinyGo ' +
      'compile step yet, so it cannot build your .go files for you.\n' +
      'Workaround: compile to WebAssembly yourself and pass the bytes directly.',
  },
  {
    id: 'zig',
    displayName: 'Zig',
    extensions: ['.zig'],
    support: 'planned',
    artifact: 'wasm',
    toolchain: [
      {
        id: 'zig',
        label: 'Zig',
        probe: ['zig', 'version'],
        installUrl: 'https://ziglang.org/download/',
        installHint: 'Install Zig from https://ziglang.org/download/',
      },
    ],
    notReadyReason:
      'Zig compiles to WebAssembly cleanly, but CrossNative has no compile step ' +
      'or metadata macro for it yet.\n' +
      'Workaround: compile to WebAssembly yourself and pass the bytes directly.',
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
    id: 'cpp',
    displayName: 'C++',
    extensions: ['.cc', '.cpp', '.cxx'],
    support: 'planned',
    artifact: 'library',
    toolchain: [
      {
        id: 'clang++',
        label: 'Clang',
        probe: ['clang++', '--version'],
        installUrl: 'https://clang.llvm.org/get_started.html',
        installHint: 'Install Clang, or Xcode Command Line Tools on macOS',
      },
    ],
    notReadyReason:
      'C++ modules load as a shared library rather than WebAssembly, which means ' +
      'they must be compiled into the app rather than loaded at runtime. That ' +
      'path exists in the native layer but is untested and has no build step.',
  },
];
