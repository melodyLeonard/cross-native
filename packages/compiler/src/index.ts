/**
 * @cross-native/compiler
 *
 * Turns source in a supported language into a loadable artifact, and reports
 * clearly when the toolchain for that language is not installed.
 */

export { compile, type CompileOptions } from './compile.ts';
export type { CompileRequest, CompileResult } from './types.ts';
export {
  inspectToolchain,
  describeMissing,
  applyFixes,
  run,
  type ToolStatus,
  type ToolchainReport,
} from './toolchain.ts';
export { embedWasm, toBase64 } from './embed.ts';
export { compileAot, resolveWamrc, type AotResult } from './aot.ts';
export {
  compileZigNativeLib,
  compileClangNativeLib,
  parseZigExports,
  parseCExports,
  generateDispatch,
  type NativeLibRequest,
  type NativeLibResult,
  type FnSig,
} from './native-lib.ts';
