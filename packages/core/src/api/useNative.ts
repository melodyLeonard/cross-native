/**
 * React binding.
 *
 * Thin wrapper over {@link createNativeModule}: the hook owns the module's
 * lifetime, while argument marshalling, plugin hooks and timeouts live in the
 * framework-independent layer so both entry points behave identically.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type {
  NativeModule,
  NativeModuleConfig,
  CallOptions,
  FunctionSignature,
  NativeFunction,
} from '../types.ts';
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
  const [ready, setReady] = useState<{
    functions: string[];
    manifest: FunctionSignature[];
    fns: Record<string, NativeFunction>;
  }>({ functions: [], manifest: [], fns: {} });

  useEffect(() => {
    let cancelled = false;
    const loading = createNativeModule(config);
    loadRef.current = loading;

    loading.then(
      (module) => {
        if (cancelled) return;
        // Route through the loaded module so plugin hooks still apply.
        const fns: Record<string, NativeFunction> = {};
        for (const [name, fn] of Object.entries(module.fns)) {
          fns[name] = (...args: unknown[]) => fn(...args);
        }
        setReady({ functions: module.functions, manifest: module.manifest, fns });
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
    () => createHandle(config, loadRef, ready),
    [config.name, config.language, ready]
  );
}

/**
 * A handle that defers every operation until the module has finished loading.
 */
function createHandle(
  config: NativeModuleConfig,
  loadRef: ModulePromiseRef,
  ready: {
    functions: string[];
    manifest: FunctionSignature[];
    fns: Record<string, NativeFunction>;
  }
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
    functions: ready.functions,
    manifest: ready.manifest,
    fns: ready.fns,

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
