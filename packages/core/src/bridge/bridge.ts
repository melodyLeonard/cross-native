/**
 * Native bridge.
 *
 * Owns backend selection and module lifecycle, and turns the native layer's
 * wire format into the ergonomic values callers expect.
 */

import type { NativeModule, NativeModuleConfig, CallOptions } from '../types.ts';
import { NativeError } from '../types.ts';
import type { Backend, CallResponse } from './backend.ts';
import { BackendError } from './backend.ts';
import { normalizeArg, type NativeArg } from './buffers.ts';

export interface BridgeOptions {
  /** Use a specific backend instead of auto-detecting one. */
  backend?: Backend;
  /** Path to the crossnative-host binary (Node backend only). */
  hostPath?: string;
}

export class NativeBridge {
  private backend: Backend | null = null;
  private modules = new Map<string, NativeModule>();
  private initializing: Promise<Backend> | null = null;
  private readonly options: BridgeOptions;

  constructor(options: BridgeOptions = {}) {
    this.options = options;
  }

  /** Which backend is in use. Null until initialized. */
  get backendName(): string | null {
    return this.backend?.name ?? null;
  }

  /**
   * Select and start a backend. Safe to call repeatedly; concurrent callers
   * share one initialization.
   */
  async initialize(): Promise<void> {
    if (this.backend) return;

    if (!this.initializing) {
      this.initializing = this.createBackend();
    }

    try {
      this.backend = await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async createBackend(): Promise<Backend> {
    if (this.options.backend) return this.options.backend;

    if (isJSIAvailable()) {
      const { JSIBackend } = await import('./jsi.ts');
      return JSIBackend.create();
    }

    if (isNodeEnvironment()) {
      const { NodeHostBackend } = await import('./node-host.ts');
      return NodeHostBackend.create({ hostPath: this.options.hostPath });
    }

    throw new NativeError(
      'No CrossNative backend available. On React Native this requires the ' +
      'native module to be installed and the new architecture enabled; ' +
      'elsewhere it requires the crossnative-host binary.'
    );
  }

  /**
   * Load a module and return a handle to it. Repeated loads of the same name
   * return the cached handle.
   */
  async loadModule(config: NativeModuleConfig): Promise<NativeModule> {
    await this.initialize();
    const backend = this.backend!;

    const cached = this.modules.get(config.name);
    if (cached) return cached;

    const artifact = resolveArtifact(config);
    const functions = await backend.load(config.name, config.language, artifact);

    const module = this.createHandle(config, backend, functions);
    this.modules.set(config.name, module);
    return module;
  }

  private createHandle(
    config: NativeModuleConfig,
    backend: Backend,
    functions: string[]
  ): NativeModule {
    const moduleId = config.name;
    let disposed = false;

    const assertLive = () => {
      if (disposed) {
        throw new NativeError(`Module '${moduleId}' has been disposed`);
      }
    };

    return {
      id: moduleId,
      language: config.language,
      functions,

      call: async (method: string, args: NativeArg[] = [], options?: CallOptions) => {
        assertLive();

        if (!functions.includes(method)) {
          throw new NativeError(
            `Module '${moduleId}' has no exported function '${method}'. ` +
            `Available: ${functions.join(', ')}`
          );
        }

        const wireArgs = args.map((arg, index) => normalizeArg(arg, index));

        try {
          const response = await backend.call(moduleId, method, wireArgs, options);
          return unwrapResponse(response);
        } catch (error) {
          if (error instanceof BackendError) {
            throw new NativeError(error.message, undefined, undefined, moduleId, method);
          }
          throw error;
        }
      },

      callSync: (): never => {
        throw new NativeError(
          `Synchronous calls are not supported by the '${backend.name}' backend. ` +
          `Use call() instead.`
        );
      },

      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.modules.delete(moduleId);
        void backend.unload(moduleId).catch(() => {
          // The module is going away regardless; surfacing this would only
          // add noise during teardown.
        });
      },
    };
  }

  async dispose(): Promise<void> {
    for (const module of this.modules.values()) module.dispose();
    this.modules.clear();

    await this.backend?.dispose();
    this.backend = null;
  }
}

/**
 * Turn a native response into what the caller actually wants.
 *
 * - No output buffers: the return value (null for void functions).
 * - One output buffer and no return value: that buffer. This is the common
 *   shape — `matrix_multiply(a, b, out, n)` and friends write their answer
 *   into a buffer and return nothing.
 * - Anything else: the full `{ result, outputs }` object.
 */
function unwrapResponse(response: CallResponse): unknown {
  const { result, outputs } = response;

  if (outputs.length === 0) return result;
  if (outputs.length === 1 && result === null) return outputs[0];
  return { result, outputs };
}

/**
 * Work out which compiled artifact backs a module.
 *
 * `source` points at the original source file; the CLI compiles it to a .wasm
 * sitting next to it unless `artifact` says otherwise.
 */
function resolveArtifact(config: NativeModuleConfig): string {
  if (config.artifact) return config.artifact;
  if (config.source.endsWith('.wasm')) return config.source;

  const withoutExtension = config.source.replace(/\.[^./\\]+$/, '');
  return `${withoutExtension}.wasm`;
}

function isJSIAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).__CrossNativeProxy !== 'undefined'
  );
}

function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  );
}
