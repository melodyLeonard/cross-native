import { join } from 'node:path';
import { run } from '../toolchain.ts';
import type { CompileRequest, CompileResult } from '../types.ts';

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
      '-fno-entry',
      '-rdynamic',
      '-O', 'ReleaseFast',
      `-femit-bin=${artifact}`,
    ],
    request.sourceDir
  );

  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `zig exited with code ${code}` };
  }
  return { ok: true, artifactPath: artifact };
}
