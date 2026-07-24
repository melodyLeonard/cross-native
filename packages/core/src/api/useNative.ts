import { useEffect, useRef, useCallback } from 'react';
import {
  NativeModule,
  NativeModuleConfig,
  CallOptions,
  NativeError,
  NativeTimeoutError,
} from '../types.ts';
import { NativeBridge } from '../bridge/bridge.ts';

/**
 * Hook to use a native module in a React component.
 * 
 * @example
 * ```typescript
 * const MathModule = useNativeModule({
 *   name: 'math',
 *   source: './native/math.rs',
 *   language: 'rust',
 * });
 * 
 * // Use in component
 * const result = await MathModule.computeMatrix(data);
 * ```
 */
export function useNativeModule(config: NativeModuleConfig): NativeModule {
  const bridgeRef = useRef<NativeBridge | null>(null);
  const moduleRef = useRef<NativeModule | null>(null);

  // Initialize bridge on mount
  useEffect(() => {
    const init = async () => {
      const bridge = new NativeBridge();
      await bridge.initialize();
      bridgeRef.current = bridge;

      const module = await bridge.loadModule(config);
      
      // Apply plugins
      if (config.plugins) {
        for (const plugin of config.plugins) {
          plugin.onModuleLoad?.(module);
        }
      }
      
      moduleRef.current = module;
    };

    init();

    // Cleanup
    return () => {
      if (moduleRef.current) {
        // Notify plugins
        config.plugins?.forEach(p => p.onModuleLoad?.(moduleRef.current!));
        moduleRef.current.dispose();
      }
      bridgeRef.current?.dispose();
    };
  }, [config.name, config.source]);

  // Create module proxy
  const module = useCallback(() => {
    if (!moduleRef.current) {
      throw new NativeError('Native module not initialized yet');
    }
    return moduleRef.current;
  }, []);

  // Return module-like object with automatic plugin hooks
  return {
    get id() { return config.name; },
    get language() { return config.language; },

    call: async (method: string, args: unknown[], options?: CallOptions) => {
      const mod = module();
      const context = {
        callId: generateCallId(),
        moduleId: config.name,
        methodId: method,
        args,
        startTime: Date.now(),
        options,
      };

      // Apply beforeCall plugins
      let modifiedContext = context;
      for (const plugin of config.plugins || []) {
        if (plugin.beforeCall) {
          modifiedContext = await plugin.beforeCall(modifiedContext) as typeof context;
        }
      }

      try {
        // Apply timeout if specified
        const callPromise = mod.call(method, args, options);
        const timeoutPromise = options?.timeout
          ? createTimeoutPromise(options.timeout, config.name, method)
          : null;

        const result = timeoutPromise
          ? await Promise.race([callPromise, timeoutPromise])
          : await callPromise;

        // Apply afterCall plugins
        for (const plugin of config.plugins || []) {
          plugin.afterCall?.(modifiedContext, result);
        }

        return result;
      } catch (error) {
        // Apply onError plugins
        const nativeError = error instanceof Error ? error : new NativeError(String(error));
        for (const plugin of config.plugins || []) {
          plugin.onError?.(modifiedContext, nativeError);
        }
        throw error;
      }
    },

    callSync: (method: string, args: unknown[]) => {
      const mod = module();
      return mod.callSync(method, args);
    },

    dispose: () => {
      moduleRef.current?.dispose();
      bridgeRef.current?.dispose();
    },
  } as NativeModule;
}

function generateCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function createTimeoutPromise(
  timeout: number,
  moduleId: string,
  methodId: string
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new NativeTimeoutError(moduleId, methodId, timeout));
    }, timeout);
  });
}
