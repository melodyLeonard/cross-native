/**
 * Detect JSI availability in React Native
 */

export function isNativeAvailable(): boolean {
  // Check for JSI indicators
  if (typeof global === 'undefined') return false;
  
  // Check for Worklet runtime (Reanimated)
  if ((global as Record<string, unknown>)._WORKLET_RUNTIME !== undefined) {
    return true;
  }
  
  // Check for JSI executor description
  // @ts-ignore
  if (global.__jsiExecutorDescription !== undefined) {
    return true;
  }
  
  // Check for native call sync hook
  // @ts-ignore
  if (typeof global.nativeCallSyncHook === 'function') {
    return true;
  }
  
  // Check for CrossNative global
  // @ts-ignore
  if (typeof global.__CROSS_NATIVE_CALL__ === 'function') {
    return true;
  }
  
  return false;
}

export function getRuntimeInfo(): {
  name: string;
  version?: string;
  features: string[];
} {
  const features: string[] = [];
  
  if ((global as Record<string, unknown>)._WORKLET_RUNTIME) {
    features.push('worklet-runtime');
  }
  
  // @ts-ignore
  if (global.__jsiExecutorDescription) {
    // @ts-ignore
    features.push(`jsi:${global.__jsiExecutorDescription}`);
  }
  
  // @ts-ignore
  if (global.HermesInternal) {
    features.push('hermes');
  }
  
  // @ts-ignore
  if (global._v8runtime) {
    features.push('v8');
  }
  
  return {
    name: features.includes('hermes') ? 'Hermes' : 'JSC',
    features,
  };
}
