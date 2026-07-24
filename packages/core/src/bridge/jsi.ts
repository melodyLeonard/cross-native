/**
 * JSI backend — the on-device path.
 *
 * The native module installs a `__CrossNativeProxy` object into the JS global.
 * This backend is a thin adapter over it; the real work (thread pool, wasm3
 * runtime, argument marshalling) happens in the same C++ core the Node backend
 * drives, in-process rather than over a pipe.
 */

import type { Backend, CallResponse, LoadedModule, ModuleSource } from './backend.ts';
import { BackendError } from './backend.ts';
import type { CallOptions } from '../types.ts';

/** Shape of the object the native module installs into the global scope. */
interface CrossNativeProxy {
  loadModule(moduleId: string, language: string, path: string): Promise<boolean>;
  loadModuleFromBuffer(
    moduleId: string,
    language: string,
    bytes: ArrayBuffer | Uint8Array
  ): Promise<boolean>;
  callFunction(
    moduleId: string,
    functionName: string,
    argsJson: string,
    optionsJson: string
  ): Promise<string>;
  loadLinkedModule(moduleId: string): string;
  getModuleFunctions(moduleId: string): string[];
  getModuleManifest(moduleId: string): string;
  isModuleLoaded(moduleId: string): boolean;
  unloadModule(moduleId: string): void;
  getStats(): Record<string, number>;
  setLogLevel(level: string): void;
}

/** Installs the proxy. Registered by react-native-cross-native at import time. */
type Installer = () => Promise<void>;

let installer: Installer | null = null;

/**
 * Register the platform's installer.
 *
 * Native modules are constructed lazily, so the proxy does not exist until
 * something asks for it. The platform package registers this hook so the core
 * can trigger installation without depending on react-native.
 */
export function registerJSIInstaller(install: Installer): void {
  installer = install;
}

/** Whether a JSI path is available, either already installed or installable. */
export function isJSIAvailable(): boolean {
  return Boolean((globalThis as any).__CrossNativeProxy) || installer !== null;
}

function getProxy(): CrossNativeProxy {
  const proxy = (globalThis as any).__CrossNativeProxy;
  if (!proxy) {
    throw new BackendError(
      'CrossNative native module is not installed. Check that the pod/gradle ' +
      'dependency is linked and that the app was rebuilt.'
    );
  }
  return proxy as CrossNativeProxy;
}

export class JSIBackend implements Backend {
  readonly name = 'jsi';

  /** Run the platform installer, if the proxy is not already present. */
  static async create(): Promise<JSIBackend> {
    if (!(globalThis as any).__CrossNativeProxy && installer) {
      await installer();
    }
    getProxy(); // fail early with a clear message if it is still missing
    return new JSIBackend();
  }

  async load(moduleId: string, language: string, source: ModuleSource): Promise<LoadedModule> {
    const proxy = getProxy();

    // A linked module is resolved from the app's own symbols; there is nothing
    // to load, and its manifest doubles as its function list.
    if (source.kind === 'linked') {
      let manifest = [];
      try {
        manifest = JSON.parse(proxy.loadLinkedModule(moduleId));
      } catch (error) {
        throw new BackendError(
          `Failed to load linked module '${moduleId}': ${(error as Error).message}`
        );
      }
      return { functions: manifest.map((m: { name: string }) => m.name), manifest };
    }

    const loaded = source.kind === 'bytes'
      ? await proxy.loadModuleFromBuffer(moduleId, language, source.bytes)
      : await proxy.loadModule(moduleId, language, source.path);

    if (!loaded) {
      throw new BackendError(`Failed to load module '${moduleId}'`);
    }

    let manifest = [];
    try {
      manifest = JSON.parse(proxy.getModuleManifest(moduleId));
    } catch {
      // A module without readable metadata is still callable by name.
    }

    return { functions: proxy.getModuleFunctions(moduleId), manifest };
  }

  async call(
    moduleId: string,
    functionName: string,
    args: unknown[],
    options?: CallOptions
  ): Promise<CallResponse> {
    const optionsJson = JSON.stringify({
      priority: priorityToNumber(options?.priority),
      zeroCopy: options?.zeroCopy ?? false,
    });

    const raw = await getProxy().callFunction(
      moduleId,
      functionName,
      JSON.stringify(args),
      optionsJson
    );

    return parseEnvelope(raw, moduleId, functionName);
  }

  async unload(moduleId: string): Promise<void> {
    getProxy().unloadModule(moduleId);
  }

  /** Native-side counters (thread pool size, queue depth, loaded modules). */
  stats(): Record<string, number> {
    return getProxy().getStats();
  }

  dispose(): void {
    // The native module owns its runtime for the lifetime of the app; there is
    // nothing process-level to tear down here.
  }
}

/** The C++ side takes a numeric TaskPriority. */
function priorityToNumber(priority: CallOptions['priority']): number {
  switch (priority) {
    case 'immediate': return 0;
    case 'high': return 1;
    case 'low': return 3;
    default: return 2;
  }
}

function parseEnvelope(
  raw: string,
  moduleId: string,
  functionName: string
): CallResponse {
  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new BackendError(
      `Malformed response from native module: ${(error as Error).message}`,
      moduleId,
      functionName
    );
  }

  if (!envelope.success) {
    throw new BackendError(
      envelope.error ?? 'Unknown native error',
      moduleId,
      functionName
    );
  }

  return {
    result: envelope.result ?? null,
    outputs: envelope.outputs ?? [],
    metrics: envelope.metrics,
  };
}
