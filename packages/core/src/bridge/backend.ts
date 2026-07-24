/**
 * Backend abstraction.
 *
 * The same C++ core is reached two different ways:
 *
 *  - On device, through JSI/Nitro, in-process.
 *  - On a development machine, through the `crossnative-host` binary, so the
 *    JS API can be exercised and benchmarked without a React Native build.
 *
 * Both speak the same request/response shapes, so everything above this
 * interface is shared.
 */

import type { CallOptions, FunctionSignature } from '../types.ts';

/** What a native call returns, before ergonomic unwrapping. */
export interface CallResponse {
  /** The function's return value, or null if it returns void. */
  result: unknown;
  /** Contents of any out/inout buffers, in the order they were passed. */
  outputs: number[][];
  /** Timing reported by the native layer, when available. */
  metrics?: {
    executionTime: number;
    queueTime: number;
    threadId: string;
  };
}

/**
 * Where a module's compiled code comes from.
 *
 * On a development machine a path is convenient. On device it is not: iOS can
 * resolve a bundle path, but Android ships assets inside the APK where they are
 * not real files, so the portable option is to hand over the bytes.
 */
export type ModuleSource =
  | { kind: 'path'; path: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  /** A Rust static library linked into the app (iOS native FFI). */
  | { kind: 'linked' };

/** What a backend reports after loading a module. */
export interface LoadedModule {
  functions: string[];
  manifest: FunctionSignature[];
}

export interface Backend {
  /** Human-readable backend name, for diagnostics. */
  readonly name: string;

  /**
   * Load a compiled module.
   *
   * @returns Its exported names and declared signatures
   */
  load(moduleId: string, language: string, source: ModuleSource): Promise<LoadedModule>;

  /** Call a function. Arguments are already in wire format. */
  call(
    moduleId: string,
    functionName: string,
    args: unknown[],
    options?: CallOptions
  ): Promise<CallResponse>;

  /** Unload a module and free its native resources. */
  unload(moduleId: string): Promise<void>;

  /** Tear down the backend. */
  dispose(): Promise<void> | void;
}

/** Raised when a native call fails on the other side of the bridge. */
export class BackendError extends Error {
  readonly moduleId?: string;
  readonly functionName?: string;

  constructor(message: string, moduleId?: string, functionName?: string) {
    super(message);
    this.name = 'BackendError';
    this.moduleId = moduleId;
    this.functionName = functionName;
  }
}
