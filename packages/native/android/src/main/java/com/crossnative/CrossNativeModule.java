package com.crossnative;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder;

/**
 * Installs the CrossNative JSI proxy.
 *
 * The module exists only to reach the JavaScript runtime; everything else lives
 * in the shared C++ core. Native modules are created lazily, so JavaScript
 * calls install() once at startup rather than relying on when this module
 * happens to be constructed.
 */
public class CrossNativeModule extends ReactContextBaseJavaModule {

  public static final String NAME = "CrossNative";

  static {
    System.loadLibrary("crossnative");
  }

  public CrossNativeModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  /**
   * Install {@code globalThis.__CrossNativeProxy}.
   *
   * <p>Resolves once the proxy is installed, so JavaScript can await it before
   * loading modules.
   */
  @ReactMethod
  public void install(Promise promise) {
    try {
      CallInvokerHolder callInvokerHolder =
          getReactApplicationContext().getJSCallInvokerHolder();

      if (callInvokerHolder == null) {
        promise.reject(
            "crossnative_no_call_invoker",
            "CrossNative could not reach the JavaScript runtime: no CallInvoker.");
        return;
      }

      if (!nativeInstall(callInvokerHolder)) {
        promise.reject(
            "crossnative_install_failed",
            "CrossNative timed out waiting for the JavaScript thread.");
        return;
      }

      promise.resolve(true);
    } catch (Throwable error) {
      promise.reject("crossnative_install_failed", error);
    }
  }

  /** Returns true once the proxy has been installed on the JS thread. */
  private static native boolean nativeInstall(CallInvokerHolder callInvokerHolder);
}
