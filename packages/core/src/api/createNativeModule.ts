/**
 * Framework-independent entry point.
 *
 * `useNativeModule` is the React wrapper around this. Use this directly in
 * plain scripts, tests, benchmarks, or any non-React context.
 */

import type {
  NativeModule,
  NativeModuleConfig,
  CallOptions,
  CallContext,
  Plugin,
} from '../types.ts';
import { NativeError, NativeTimeoutError } from '../types.ts';
import { NativeBridge, type BridgeOptions } from '../bridge/bridge.ts';

/**
 * Load a native module.
 *
 * @example
 * const compute = await createNativeModule({
 *   name: 'compute',
 *   source: './native/compute.rs',
 *   language: 'rust',
 * });
 *
 * const sum = await compute.call('add', [1.5, 2.5]); // 4
 * compute.dispose();
 */
export async function createNativeModule(
  config: NativeModuleConfig,
  options: BridgeOptions = {}
): Promise<NativeModule> {
  const bridge = new NativeBridge(options);
  const module = await bridge.loadModule(config);

  for (const plugin of config.plugins ?? []) {
    plugin.onModuleLoad?.(module);
  }

  const wrapped = withPlugins(module, config);

  return {
    ...wrapped,
    dispose: () => {
      module.dispose();
      void bridge.dispose();
    },
  };
}

/**
 * Wrap a module so plugin hooks and per-call timeouts apply to every call.
 *
 * Shared by {@link createNativeModule} and the React hook so both behave
 * identically.
 */
export function withPlugins(
  module: NativeModule,
  config: Pick<NativeModuleConfig, 'name' | 'plugins'>
): NativeModule {
  const plugins: Plugin[] = config.plugins ?? [];

  return {
    ...module,

    call: async (method: string, args: unknown[] = [], options?: CallOptions) => {
      // Fast path: no plugins to run, so skip the call context and just apply
      // the timeout/abort guard. Both must work whether or not plugins are
      // configured, so the guard lives here rather than only in the plugin path.
      if (plugins.length === 0) {
        return guardCall(module.call(method, args, options), options, config.name, method);
      }

      let context: CallContext = {
        callId: generateCallId(),
        moduleId: config.name,
        methodId: method,
        args,
        startTime: Date.now(),
        options,
      };

      for (const plugin of plugins) {
        if (plugin.beforeCall) {
          context = (await plugin.beforeCall(context)) ?? context;
        }
      }

      try {
        const call = module.call(method, context.args, options);
        const result = await guardCall(call, options, config.name, method);

        for (const plugin of plugins) {
          await plugin.afterCall?.(context, result);
        }
        return result;
      } catch (error) {
        const nativeError =
          error instanceof Error ? error : new NativeError(String(error));
        for (const plugin of plugins) {
          await plugin.onError?.(context, nativeError);
        }
        throw nativeError;
      }
    },
  };
}

/**
 * Bound how long the caller waits on a call, via an optional timeout and/or an
 * `AbortSignal`. Whichever fires first rejects the returned promise.
 *
 * Important: this cancels the *wait*, not the work. The native call keeps
 * running on its worker thread until it finishes on its own — WASM execution
 * cannot currently be interrupted mid-flight (that needs WAMR's thread manager,
 * which this build does not include). So a genuinely runaway module still holds
 * its worker; timeout/abort free the caller, not the thread.
 */
function guardCall<T>(
  promise: Promise<T>,
  options: CallOptions | undefined,
  moduleId: string,
  methodId: string
): Promise<T> {
  const timeout = options?.timeout;
  const signal = options?.signal;
  if (!timeout && !signal) return promise;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fn: (v: never) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value as never);
    };
    function onAbort() {
      finish(reject, new NativeError(`Call to ${moduleId}.${methodId} was aborted`));
    }

    // Attach first, so the underlying call's eventual settlement is always
    // handled — even when we reject early via abort/timeout and the native work
    // keeps running and later rejects (e.g. the module is disposed meanwhile).
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );

    if (signal?.aborted) return onAbort();
    if (timeout) {
      timer = setTimeout(
        () => finish(reject, new NativeTimeoutError(moduleId, methodId, timeout)),
        timeout
      );
    }
    signal?.addEventListener('abort', onAbort);
  });
}

function generateCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
