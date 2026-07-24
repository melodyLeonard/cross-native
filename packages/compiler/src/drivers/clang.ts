/**
 * C and C++ compile drivers.
 *
 * Both go through Zig's bundled clang (`zig cc` / `zig c++`), so the single Zig
 * toolchain that CrossNative already uses for `.zig` also covers C and C++ — no
 * emscripten, no separate wasi-sdk. The target is a WASI *reactor* module: it
 * links libc/libm (so <math.h>, <vector>, etc. work) but has no `_start` and no
 * argument/exit imports, which keeps pure-compute modules import-free and lets
 * the runtime load them like any other `.wasm`.
 */

import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

/** Zig drives clang; CROSSNATIVE_ZIG overrides the binary (see the zig driver). */
function resolveZig(): string {
  return process.env.CROSSNATIVE_ZIG ?? 'zig';
}

/** Flags shared by C and C++: reactor model, keep exports, optimise for speed. */
const COMMON = [
  '--target=wasm32-wasi',
  '-mexec-model=reactor',   // exports, no _start / no argv/exit imports
  '-Wl,--export-dynamic',   // keep exported symbols visible
  '-O3',
];

async function compileClang(
  request: CompileRequest,
  driver: 'cc' | 'c++',
  defaultEntry: string,
  extra: readonly string[]
): Promise<CompileResult> {
  const entry = request.entryFile ?? defaultEntry;
  const artifact = join(request.sourceDir, `${request.moduleName}.wasm`);

  const { code, stderr } = await run(
    [resolveZig(), driver, entry, '-o', artifact, ...COMMON, ...extra],
    request.sourceDir
  );

  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `zig ${driver} exited with code ${code}` };
  }
  return { ok: true, artifactPath: artifact };
}

export function compileC(request: CompileRequest): Promise<CompileResult> {
  return compileClang(request, 'cc', 'main.c', []);
}

export function compileCpp(request: CompileRequest): Promise<CompileResult> {
  // -w silences libc++ header nullability warnings; no exceptions/rtti keeps the
  // module small and avoids the unwinder.
  return compileClang(request, 'c++', 'main.cpp', ['-fno-exceptions', '-fno-rtti', '-w']);
}
