/**
 * Compiling a module, whatever language it is written in.
 *
 * The registry decides what is supported; this picks the driver. A language
 * with no driver fails with the registry's own "not implemented yet" message
 * rather than something invented here.
 */

import { requireUsableLanguage } from '@cross-native/languages';
import { compileRust } from './drivers/rust.ts';
import { compileZig } from './drivers/zig.ts';
import { compileC, compileCpp } from './drivers/clang.ts';
import { compileGo } from './drivers/go.ts';
import { describeMissing, inspectToolchain, applyFixes } from './toolchain.ts';
import type { CompileRequest, CompileResult } from './types.ts';

/** Drivers, by language id. Adding a language means adding an entry. */
const DRIVERS: Record<string, (request: CompileRequest) => Promise<CompileResult>> = {
  rust: compileRust,
  zig: compileZig,
  c: compileC,
  cpp: compileCpp,
  go: compileGo,
};

export interface CompileOptions extends CompileRequest {
  language: string;
  /** Run any available autoFix commands before giving up. */
  fix?: boolean;
}

/**
 * Validate, check the toolchain, then compile.
 *
 * Failures are separated deliberately: an unsupported language, a missing
 * toolchain and a genuine compile error need different responses, so they get
 * different messages.
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const language = requireUsableLanguage(options.language);

  const driver = DRIVERS[language.id];
  if (!driver) {
    return {
      ok: false,
      error:
        `${language.displayName} is marked supported but has no compile driver. ` +
        `This is a bug in CrossNative.`,
    };
  }

  let report = await inspectToolchain(language.id);
  if (!report.ready && options.fix && report.fixable.length > 0) {
    await applyFixes(report);
    report = await inspectToolchain(language.id);
  }
  if (!report.ready) {
    return { ok: false, error: describeMissing(report) };
  }

  const result = await driver(options);
  
  if (result.ok && result.wasmPath && options.targetPlatform === 'ios') {
    // Generate AOT for iOS
    const { execSync } = require('child_process');
    try {
      execSync(`wamrc --target=aarch64 -o ${result.wasmPath.replace('.wasm', '.a')} ${result.wasmPath}`);
      result.aotPath = result.wasmPath.replace('.wasm', '.a');
    } catch (e) {
      console.warn('Failed to run wamrc for AOT compilation:', e);
    }
  }

  return result;
}
