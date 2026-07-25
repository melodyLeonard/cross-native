import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

// C and C++ go through zig cc / zig c++, so they share the zig toolchain.
function resolveZig(): string {
  return process.env.CROSSNATIVE_ZIG ?? 'zig';
}

const COMMON = [
  '--target=wasm32-wasi',
  '-mexec-model=reactor',
  '-Wl,--export-dynamic',
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
  return compileClang(request, 'c++', 'main.cpp', ['-fno-exceptions', '-fno-rtti', '-w']);
}
