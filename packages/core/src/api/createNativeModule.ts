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
  if (plugins.length === 0) return module;

  return {
    ...module,

    call: async (method: string, args: unknown[] = [], options?: CallOptions) => {
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

        const result = options?.timeout
          ? await withTimeout(call, options.timeout, config.name, method)
          : await call;

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
 * Reject if a call outruns its timeout.
 *
 * The underlying native call is not cancelled — it keeps running on its worker
 * thread. The timeout only bounds how long the caller waits.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  moduleId: string,
  methodId: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NativeTimeoutError(moduleId, methodId, timeout));
    }, timeout);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function generateCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
