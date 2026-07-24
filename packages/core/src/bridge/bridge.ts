/**
 * Native bridge.
 *
 * Owns backend selection and module lifecycle, and turns the native layer's
 * wire format into the ergonomic values callers expect.
 */

import type { NativeModule, NativeModuleConfig, CallOptions } from '../types.ts';
import { NativeError } from '../types.ts';
import type { Backend, CallResponse, LoadedModule, ModuleSource } from './backend.ts';
import { BackendError } from './backend.ts';
import { normalizeArg, type NativeArg } from './buffers.ts';
import { isJSIAvailable, JSIBackend } from './jsi.ts';
import { buildCallables } from './callables.ts';
import { requireUsableLanguage } from '@cross-native/languages';

export interface BridgeOptions {
  /** Use a specific backend instead of auto-detecting one. */
  backend?: Backend;
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

    // Imported statically: React Native turns a dynamic import() into a lazy
    // bundle request at runtime, which fails outside a dev server.
    if (isJSIAvailable()) {
      return JSIBackend.create();
    }

    throw new NativeError(
      'No CrossNative backend available. On React Native this means the native ' +
      'module is not linked — rebuild the app after installing the package. ' +
      'Off device, construct a NodeHostBackend and pass it as `backend`.'
    );
  }

  /**
   * Load a module and return a handle to it. Repeated loads of the same name
   * return the cached handle.
   */
  async loadModule(config: NativeModuleConfig): Promise<NativeModule> {
    // Fail here, with a message naming what is supported, rather than deep in
    // the native layer with a truncated error.
    requireUsableLanguage(config.language);

    await this.initialize();
    const backend = this.backend!;

    const cached = this.modules.get(config.name);
    if (cached) return cached;

    const loaded = await backend.load(
      config.name,
      config.language,
      resolveSource(config)
    );

    const module = this.createHandle(config, backend, loaded);
    this.modules.set(config.name, module);
    return module;
  }

  private createHandle(
    config: NativeModuleConfig,
    backend: Backend,
    loaded: LoadedModule
  ): NativeModule {
    const moduleId = config.name;
    const { functions, manifest } = loaded;
    // Functions the module declared: their arguments are already in natural
    // form and the native side marshals them from the signature.
    const declared = new Set(manifest.map((signature) => signature.name));
    let disposed = false;

    const assertLive = () => {
      if (disposed) {
        throw new NativeError(`Module '${moduleId}' has been disposed`);
      }
    };

    const call = async (method: string, args: NativeArg[] = [], options?: CallOptions) => {
        assertLive();

        if (!functions.includes(method)) {
          throw new NativeError(
            `Module '${moduleId}' has no exported function '${method}'. ` +
            `Available: ${functions.join(', ')}`
          );
        }

        // Undeclared functions still use the explicit buffer protocol.
        const wireArgs = declared.has(method)
          ? args
          : args.map((arg, index) => normalizeArg(arg, index));

        try {
          const response = await backend.call(moduleId, method, wireArgs, options);
          return unwrapResponse(response);
        } catch (error) {
          if (error instanceof BackendError) {
            throw new NativeError(error.message, undefined, undefined, moduleId, method);
          }
          throw error;
        }
      };

    return {
      id: moduleId,
      language: config.language,
      functions,
      manifest,

      // Named functions built from the module's own metadata, so callers can
      // write compute.fns.matrixMultiply(a, b) instead of calling by string.
      fns: buildCallables(manifest, call),

      call,

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
 * Work out where a module's compiled code comes from.
 *
 * Explicit `bytes` win, since that is the only portable option on device.
 * Otherwise `artifact` names the .wasm, defaulting to `source` with its
 * extension swapped.
 */
function resolveSource(config: NativeModuleConfig): ModuleSource {
  if (config.linked) return { kind: 'linked' };

  if (config.bytes) {
    const bytes = config.bytes instanceof Uint8Array
      ? config.bytes
      : new Uint8Array(config.bytes);
    return { kind: 'bytes', bytes };
  }

  if (config.artifact) return { kind: 'path', path: config.artifact };
  if (config.source.endsWith('.wasm')) return { kind: 'path', path: config.source };

  const withoutExtension = config.source.replace(/\.[^./\\]+$/, '');
  return { kind: 'path', path: `${withoutExtension}.wasm` };
}

