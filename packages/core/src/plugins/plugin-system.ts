/**
 * Plugin system for CrossNative
 * Allows extending functionality with custom hooks
 */

import type { Plugin, CallContext, PerformanceMetrics, NativeModule } from '../types.ts';

export interface PluginRegistry {
  register(plugin: Plugin): void;
  unregister(pluginName: string): void;
  get(name: string): Plugin | undefined;
  list(): Plugin[];
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<string, Plugin>();

  return {
    register(plugin: Plugin) {
      plugins.set(plugin.name, plugin);
    },

    unregister(pluginName: string) {
      plugins.delete(pluginName);
    },

    get(name: string) {
      return plugins.get(name);
    },

    list() {
      return Array.from(plugins.values());
    },
  };
}

/**
 * Helper to create a plugin with typed configuration
 */
export function createPlugin<TConfig>(
  name: string,
  version: string,
  factory: (config: TConfig) => Partial<Plugin>,
  defaultConfig: TConfig
): (config?: Partial<TConfig>) => Plugin {
  return (config = {}) => {
    const merged = { ...defaultConfig, ...config };
    const hooks = factory(merged);

    return {
      name,
      version,
      ...hooks,
    } as Plugin;
  };
}

/**
 * Compose multiple plugins into one
 */
export function composePlugins(...plugins: Plugin[]): Plugin {
  return {
    name: 'composed',
    version: '1.0.0',

    onModuleLoad: (module: NativeModule) => {
      plugins.forEach(p => p.onModuleLoad?.(module));
    },

    beforeCall: async (context: CallContext) => {
      let current = context;
      for (const plugin of plugins) {
        if (plugin.beforeCall) {
          current = await plugin.beforeCall(current) as CallContext;
        }
      }
      return current;
    },

    afterCall: async (context: CallContext, result: unknown) => {
      for (const plugin of plugins) {
        await plugin.afterCall?.(context, result);
      }
    },

    onError: async (context: CallContext, error: Error) => {
      for (const plugin of plugins) {
        await plugin.onError?.(context, error);
      }
    },

    onMetrics: (metrics: PerformanceMetrics) => {
      plugins.forEach(p => p.onMetrics?.(metrics));
    },
  };
}
