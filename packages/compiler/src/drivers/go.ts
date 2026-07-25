import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

function resolveGo(): string {
  return process.env.CROSSNATIVE_GO ?? 'go';
}

// Needs Go 1.24+ for //go:wasmexport. Builds a wasip1 reactor module.
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
