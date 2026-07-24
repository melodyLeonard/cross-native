/**
 * Go compile driver.
 *
 * Modern Go (1.21+, and cleanly on 1.24+ with //go:wasmexport) targets
 * `GOOS=wasip1 GOARCH=wasm` directly — no TinyGo needed. Built as a c-shared
 * *reactor* module it exports the annotated functions and an `_initialize` that
 * brings up the Go runtime/scheduler; the CrossNative runtime enables WASI so
 * the module's scheduler/GC imports resolve. `go` is resolved from
 * CROSSNATIVE_GO or PATH.
 */

import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

function resolveGo(): string {
  return process.env.CROSSNATIVE_GO ?? 'go';
}

export async function compileGo(request: CompileRequest): Promise<CompileResult> {
  const entry = request.entryFile ?? 'main.go';
  const artifact = join(request.sourceDir, `${request.moduleName}.wasm`);

  const { code, stderr } = await run(
    [resolveGo(), 'build', '-buildmode=c-shared', '-o', artifact, entry],
    request.sourceDir,
    { GOOS: 'wasip1', GOARCH: 'wasm' }
  );

  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `go build exited with code ${code}` };
  }
  return { ok: true, artifactPath: artifact };
}
