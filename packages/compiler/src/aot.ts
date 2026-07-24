/**
 * AOT compilation: turn a `.wasm` into a `.aot` of near-native machine code.
 *
 * AOT is what makes CrossNative fast (~8x over the interpreter) and is legal on
 * iOS, because wamrc compiles ahead of time rather than JITing at runtime.
 *
 * wamrc is a large LLVM-based tool that cannot be bundled in an npm package,
 * so it is resolved from CROSSNATIVE_WAMRC (an explicit path) — the acquisition
 * of a prebuilt wamrc is handled separately. Its flags must match the runtime's
 * build configuration: aarch64 (one AOT serves every arm64 target, since the
 * loader checks arch not OS), software bounds checks, and SIMD disabled.
 */

import { run } from './toolchain.ts';

/** arm64 covers iOS device, iOS simulator on Apple Silicon, and Android arm64. */
const AOT_TARGET = 'aarch64v8';

export interface AotResult {
  ok: boolean;
  artifactPath?: string;
  error?: string;
}

/** Where to find wamrc, or null if it has not been provided. */
export function resolveWamrc(): string | null {
  return process.env.CROSSNATIVE_WAMRC ?? null;
}

/**
 * Compile `wasmPath` to `<wasmPath>.aot`.
 *
 * Returns ok:false (not throwing) when wamrc is unavailable, so callers can
 * fall back to shipping the interpreter `.wasm` — slower, but it always works.
 */
export async function compileAot(wasmPath: string): Promise<AotResult> {
  const wamrc = resolveWamrc();
  if (!wamrc) {
    return { ok: false, error: 'wamrc not available (set CROSSNATIVE_WAMRC)' };
  }

  const aotPath = wasmPath.replace(/\.wasm$/, '.aot');
  const { code, stderr } = await run([
    wamrc,
    `--target=${AOT_TARGET}`,
    '--bounds-checks=1',
    '--disable-simd',
    '-o', aotPath,
    wasmPath,
  ]);

  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `wamrc exited with code ${code}` };
  }
  return { ok: true, artifactPath: aotPath };
}
