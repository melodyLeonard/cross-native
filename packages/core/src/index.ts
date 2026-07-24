/**
 * CrossNative Core API
 *
 * Runs compiled languages (Rust, Go, C++, Zig) off the JavaScript thread.
 *
 * @example
 * ```typescript
 * import { createNativeModule, outBuffer } from '@cross-native/core';
 *
 * const compute = await createNativeModule({
 *   name: 'compute',
 *   source: './native/compute.rs',
 *   language: 'rust',
 * });
 *
 * const sum = await compute.call('add', [1.5, 2.5]);            // 4
 * const product = await compute.call('matrix_multiply', [
 *   a, b, outBuffer(n * n), n,
 * ]);
 * ```
 */

// Core API
export { createNativeModule, withPlugins } from './api/createNativeModule.ts';
export { useNativeModule } from './api/useNative.ts';

// Bridge
export { NativeBridge, type BridgeOptions } from './bridge/bridge.ts';
export { BackendError, type Backend, type CallResponse } from './bridge/backend.ts';
export { JSIBackend, registerJSIInstaller, isJSIAvailable } from './bridge/jsi.ts';

// Array arguments
export {
  inBuffer,
  outBuffer,
  inoutBuffer,
  isBufferArg,
  normalizeArg,
  type BufferArg,
  type BufferElementType,
  type InBuffer,
  type OutBuffer,
  type InOutBuffer,
  type NativeArg,
} from './bridge/buffers.ts';

// Bridge utilities
export { createSharedBuffer, viewAsFloat64Array } from './bridge/memory.ts';
export { isNativeAvailable, getRuntimeInfo } from './bridge/detector.ts';

// Plugins
export { createPlugin, composePlugins } from './plugins/plugin-system.ts';
export { ConsolePlugin } from './plugins/console.ts';
export { PerformancePlugin } from './plugins/performance.ts';

// Types
export type {
  NativeModule,
  NativeModuleConfig,
  NativeFunction,
  NativeLanguage,
  CallOptions,
  Plugin,
  CallContext,
  PerformanceMetrics,
  Parameter,
} from './types.ts';

// Error types
export { NativeError, NativeTimeoutError } from './types.ts';
