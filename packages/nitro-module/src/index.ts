/**
 * react-native-cross-native
 *
 * Installs the JSI proxy the core's JSIBackend talks to, then re-exports the
 * public API so an app only depends on this one package.
 */

import { NativeModules } from 'react-native';
import { registerJSIInstaller } from '@cross-native/core';

interface CrossNativeInstaller {
  install(): Promise<boolean>;
}

let installation: Promise<void> | null = null;

/**
 * Install `globalThis.__CrossNativeProxy`.
 *
 * Native modules are constructed lazily, so nothing reaches the JS runtime
 * until this is called. Safe to call repeatedly — the work happens once.
 *
 * `createNativeModule` calls this automatically; call it yourself only to
 * control when the cost is paid, or to surface a setup failure early.
 */
export function installCrossNative(): Promise<void> {
  if (installation) return installation;

  installation = (async () => {
    if ((globalThis as any).__CrossNativeProxy) return;

    const native = NativeModules.CrossNative as CrossNativeInstaller | undefined;
    if (!native?.install) {
      throw new Error(
        'The CrossNative native module is not linked. Rebuild the app after ' +
        'installing the package (iOS: cd ios && pod install).'
      );
    }

    await native.install();

    if (!(globalThis as any).__CrossNativeProxy) {
      throw new Error('CrossNative installed but __CrossNativeProxy is missing.');
    }
  })();

  // Let a failed attempt be retried rather than caching the rejection forever.
  installation.catch(() => {
    installation = null;
  });

  return installation;
}

export * from '@cross-native/core';

// Let the core reach the native module without depending on react-native.
registerJSIInstaller(installCrossNative);
