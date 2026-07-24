/** Shared vocabulary for the compile drivers. */

export interface CompileRequest {
  /** Directory holding the module's source. */
  sourceDir: string;
  /** Crate/module name, used for the produced artifact. */
  moduleName: string;
  /** Path to the crossnative runtime crate, for generated manifests. */
  runtimeCratePath: string;

  /**
   * Explicit library entry file, relative to sourceDir. When omitted the
   * driver finds it (src/lib.rs, a top-level lib.rs, or the only .rs present).
   */
  entryFile?: string;
}

export type CompileResult =
  | { ok: true; artifactPath: string }
  | { ok: false; error: string };
