/**
 * JSI backend — the on-device path.
 *
 * The native module installs a `__CrossNativeProxy` object into the JS global
 * when it loads. This backend is a thin adapter over that object; the real work
 * (thread pool, wasm3 runtime, argument marshalling) happens in the same C++
 * core the Node backend drives.
 *
 * NOTE: this path is not yet exercised end-to-end — it needs the Nitro module
 * build (nitrogen codegen + podspec/gradle wiring) to be finished. The Node
 * backend is what is currently verified. See ROADMAP.md.
 */

import type { Backend, CallResponse } from './backend.ts';
import { BackendError } from './backend.ts';
import type { CallOptions } from '../types.ts';

/** Shape of the object the native module installs into the global scope. */
interface CrossNativeProxy {
  loadModule(moduleId: string, language: string, path: string): Promise<boolean>;
  callFunction(
    moduleId: string,
    functionName: string,
    argsJson: string,
    optionsJson: string
  ): Promise<string>;
  getModuleFunctions(moduleId: string): string[];
  unloadModule(moduleId: string): void;
  getStats(): Record<string, number>;
}

function getProxy(): CrossNativeProxy {
  const proxy = (globalThis as any).__CrossNativeProxy;
  if (!proxy) {
    throw new BackendError(
      'CrossNative native module is not installed. Check that the pod/gradle ' +
      'dependency is linked and the new architecture is enabled.'
    );
  }
  return proxy as CrossNativeProxy;
}

export class JSIBackend implements Backend {
  readonly name = 'jsi';

  static create(): JSIBackend {
    getProxy(); // fail early if the native side is missing
    return new JSIBackend();
  }

  async load(moduleId: string, language: string, path: string): Promise<string[]> {
    const proxy = getProxy();
    const ok = await proxy.loadModule(moduleId, language, path);
    if (!ok) {
      throw new BackendError(`Failed to load module '${moduleId}' from ${path}`);
    }
    return proxy.getModuleFunctions(moduleId);
  }

  async call(
    moduleId: string,
    functionName: string,
    args: unknown[],
    options?: CallOptions
  ): Promise<CallResponse> {
    const proxy = getProxy();

    const optionsJson = JSON.stringify({
      priority: options?.priority ?? 'normal',
      timeout: options?.timeout,
      zeroCopy: options?.zeroCopy ?? false,
    });

    const raw = await proxy.callFunction(
      moduleId,
      functionName,
      JSON.stringify(args),
      optionsJson
    );

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

  async unload(moduleId: string): Promise<void> {
    getProxy().unloadModule(moduleId);
  }

  dispose(): void {
    // The native module owns its runtime for the lifetime of the app; there is
    // nothing process-level to tear down here.
  }
}
