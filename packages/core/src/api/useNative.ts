/**
 * React binding.
 *
 * Thin wrapper over {@link createNativeModule}: the hook owns the module's
 * lifetime, while argument marshalling, plugin hooks and timeouts live in the
 * framework-independent layer so both entry points behave identically.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { NativeModule, NativeModuleConfig, CallOptions } from '../types.ts';
import { NativeError } from '../types.ts';
import { createNativeModule } from './createNativeModule.ts';

type ModulePromiseRef = MutableRefObject<Promise<NativeModule> | null>;

/**
 * Load a native module for the lifetime of a component.
 *
 * The returned handle is stable and usable immediately — calls made before
 * loading finishes wait for it rather than failing.
 *
 * @example
 * const compute = useNativeModule({
 *   name: 'compute',
 *   source: './native/compute.rs',
 *   language: 'rust',
 * });
 *
 * const sum = await compute.call('add', [1.5, 2.5]);
 */
export function useNativeModule(config: NativeModuleConfig): NativeModule {
  const loadRef = useRef<Promise<NativeModule> | null>(null);
  const [functions, setFunctions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loading = createNativeModule(config);
    loadRef.current = loading;

    loading.then(
      (module) => {
        if (!cancelled) setFunctions(module.functions);
      },
      () => {
        // Reported to the caller when they await a call; nothing to do here.
      }
    );

    return () => {
      cancelled = true;
      loadRef.current = null;
      void loading.then((module) => module.dispose()).catch(() => {});
    };
  }, [config.name, config.source, config.artifact, config.language]);

  return useMemo(
    () => createHandle(config, loadRef, functions),
    [config.name, config.language, functions]
  );
}

/**
 * A handle that defers every operation until the module has finished loading.
 */
function createHandle(
  config: NativeModuleConfig,
  loadRef: ModulePromiseRef,
  functions: string[]
): NativeModule {
  const resolve = async (): Promise<NativeModule> => {
    const loading = loadRef.current;
    if (!loading) {
      throw new NativeError(`Module '${config.name}' is not mounted`);
    }
    return loading;
  };

  return {
    id: config.name,
    language: config.language,
    functions,

    call: async (method: string, args: unknown[] = [], options?: CallOptions) => {
      const module = await resolve();
      return module.call(method, args, options);
    },

    callSync: () => {
      throw new NativeError(
        'Synchronous calls are not available through useNativeModule; use call()'
      );
    },

    dispose: () => {
      void loadRef.current?.then((module) => module.dispose()).catch(() => {});
    },
  };
}
