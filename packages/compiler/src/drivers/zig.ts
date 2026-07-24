/**
 * Zig compile driver.
 *
 * Zig compiles straight to freestanding wasm32 with no runtime — small, fast
 * modules that our WAMR runtime loads directly. `zig` is resolved from
 * CROSSNATIVE_ZIG or PATH; it is a single self-contained toolchain (it also
 * bundles clang+lld, so the same binary can compile C to wasm).
 */

import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

/** Locate the zig binary. */
function resolveZig(): string {
  return process.env.CROSSNATIVE_ZIG ?? 'zig';
}

export async function compileZig(request: CompileRequest): Promise<CompileResult> {
  const entry = request.entryFile ?? 'main.zig';
  const artifact = join(request.sourceDir, `${request.moduleName}.wasm`);

  const { code, stderr } = await run(
    [
      resolveZig(),
      'build-exe',
      entry,
      '-target', 'wasm32-freestanding',
      '-fno-entry',       // a reactor module: exported functions, no _start
      '-rdynamic',        // keep exported symbols
      '-O', 'ReleaseFast',
      `-femit-bin=${artifact}`,
    ],
    request.sourceDir
  );

  if (code !== 0) {
    // zig's diagnostics are good; pass them through.
    return { ok: false, error: stderr.trim() || `zig exited with code ${code}` };
  }
  return { ok: true, artifactPath: artifact };
}
