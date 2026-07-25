/**
 * Core type definitions for CrossNative
 */

import type { LanguageId } from '@cross-native/languages';

/** One parameter of a declared signature. */
export interface SignatureParam {
  name: string;
  /** Wire type: "f64", "u32", "vec<f64>", "string", ... */
  type: string;
}

/**
 * A function's real signature, as declared by the module itself.
 *
 * Emitted by `#[crossnative]` and read at load time, which is what lets arrays
 * and strings marshal themselves.
 */
export interface FunctionSignature {
  name: string;
  params: SignatureParam[];
  returns: string;
}

/** A native function, callable with ordinary JavaScript values. */
export interface NativeFunction {
  (...args: unknown[]): Promise<unknown>;
  /** The declared signature, for tooling and diagnostics. */
  readonly signature?: FunctionSignature;
}

/**
 * Languages that can back a native module.
 *
 * Re-exported from the registry rather than restated here. The previous local
 * union advertised languages that did not work, so `language: 'go'` type-checked
 * and then failed at runtime.
 */
export type NativeLanguage = LanguageId;

export interface NativeModule {
  /** Unique identifier for the module */
  id: string;

  /** Language of the native implementation */
  language: NativeLanguage;

  /** Names of the functions this module exports */
  functions: string[];

  /** Declared signatures, empty if the module carries no metadata */
  manifest: FunctionSignature[];

  /**
   * The module's functions, by name.
   *
   * Available under both the original Rust name and its camelCase form:
   * `fns.process_dataset` and `fns.processDataset` are the same function.
   */
  fns: Record<string, NativeFunction>;

  /** Call a native function */
  call(method: string, args?: unknown[], options?: CallOptions): Promise<unknown>;

  /** Synchronous call for small/fast operations, where the backend supports it */
  callSync(method: string, args: unknown[]): unknown;

  /** Dispose of the module and free native resources */
  dispose(): void;
}

export interface NativeFunction {
  /** Function name */
  name: string;
  
  /** Parameter types */
  parameters: Parameter[];
  
  /** Return type */
  returnType: string;
  
  /** Whether this function runs async (default: true for safety) */
  isAsync: boolean;
  
  /** Estimated execution time in ms (for scheduling) */
  estimatedTime?: number;
}

export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: unknown;
}

export interface CallOptions {
  /** Thread priority */
  priority?: 'immediate' | 'high' | 'normal' | 'low';
  
  /** Timeout in milliseconds */
  timeout?: number;
  
  /** Whether to use zero-copy shared memory */
  zeroCopy?: boolean;
  
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface NativeModuleConfig {
  /** Module name (must match native implementation) */
  name: string;

  /** Language-specific source file */
  source: string;

  /**
   * Compiled artifact to load. Defaults to `source` with its extension swapped
   * for `.wasm`.
   */
  artifact?: string;

  /**
   * The compiled module as bytes, taking precedence over `artifact`.
   *
   * This is the portable option, and the one to use on device: iOS can resolve
   * a bundle path but Android ships assets inside the APK, where they are not
   * real files.
   */
  bytes?: Uint8Array | ArrayBuffer;

  /**
   * Use a static library linked into the app instead of loading a module.
   * The iOS speed path: iOS forbids loading executable code at runtime, so the
   * source is compiled to a static library and linked into the app binary.
   */
  linked?: boolean;

  /**
   * Entry-symbol suffix for the linked library, so several linked languages can
   * coexist in one app: Rust uses "" (crossnative_call), Zig "_zig", etc.
   * Only meaningful with `linked`.
   */
  linkedSymbol?: string;

  /** Language backend */
  language: NativeLanguage;

  /** Plugins to apply */
  plugins?: Plugin[];
  
  /** Module-specific options */
  options?: Record<string, unknown>;
}

export interface Plugin {
  name: string;
  version: string;
  
  /** Called when module is loaded */
  onModuleLoad?(module: NativeModule): void;
  
  /** Called before each function invocation */
  beforeCall?(context: CallContext): CallContext | Promise<CallContext>;
  
  /** Called after successful function invocation */
  afterCall?(context: CallContext, result: unknown): void | Promise<void>;
  
  /** Called when function throws */
  onError?(context: CallContext, error: Error): void | Promise<void>;
  
  /** Called periodically with performance metrics */
  onMetrics?(metrics: PerformanceMetrics): void;
}

export interface CallContext {
  /** Unique call ID */
  callId: string;
  
  /** Module being called */
  moduleId: string;
  
  /** Method being called */
  methodId: string;
  
  /** Arguments passed */
  args: unknown[];
  
  /** When the call started */
  startTime: number;
  
  /** Thread handling the call */
  threadId?: string;
  
  /** Options used for this call */
  options?: CallOptions;
}

export interface PerformanceMetrics {
  /** Module identifier */
  moduleId: string;
  
  /** Method identifier */
  methodId: string;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Queue wait time before execution */
  queueTime: number;
  
  /** Memory used (bytes) */
  memoryUsed?: number;
  
  /** Thread identifier */
  threadId: string;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Error thrown by native modules.
 *
 * Fields are assigned in the constructor body rather than declared as
 * parameter properties, so this file stays type-strippable and can run on Node
 * without a compile step.
 */
export class NativeError extends Error {
  readonly nativeStack?: string[];
  readonly threadId?: string;
  readonly moduleId?: string;
  readonly methodId?: string;

  constructor(
    message: string,
    nativeStack?: string[],
    threadId?: string,
    moduleId?: string,
    methodId?: string
  ) {
    super(message);
    this.name = 'NativeError';
    this.nativeStack = nativeStack;
    this.threadId = threadId;
    this.moduleId = moduleId;
    this.methodId = methodId;
  }
}

/** Error for timeout */
export class NativeTimeoutError extends NativeError {
  constructor(
    moduleId: string,
    methodId: string,
    timeout: number
  ) {
    super(
      `Native call timed out after ${timeout}ms: ${moduleId}.${methodId}`,
      undefined,
      undefined,
      moduleId,
      methodId
    );
    this.name = 'NativeTimeoutError';
  }
}
