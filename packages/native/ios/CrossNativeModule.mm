#import "CrossNativeModule.h"

#import <React/RCTCallInvoker.h>
#import <ReactCommon/CallInvoker.h>

#import "../jsi/CrossNativeJSI.hpp"

#import <memory>

using namespace facebook;

@implementation CrossNativeModule {
  /// Kept alive for the lifetime of the module so loaded WASM modules survive
  /// between calls.
  std::shared_ptr<crossnative::CrossNative> _core;
}

RCT_EXPORT_MODULE(CrossNative)

@synthesize callInvoker = _callInvoker;

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

/**
 * Install `globalThis.__CrossNativeProxy`.
 *
 * Resolves once the proxy is installed, so JavaScript can await it before
 * loading modules.
 */
RCT_EXPORT_METHOD(install
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  auto invoker = [_callInvoker callInvoker];
  if (invoker == nullptr) {
    reject(@"crossnative_no_call_invoker",
           @"CrossNative could not reach the JavaScript runtime: no CallInvoker.",
           nil);
    return;
  }

  if (_core == nullptr) {
    _core = std::make_shared<crossnative::CrossNative>();
  }
  auto core = _core;

  // Everything the JSI layer schedules has to land on the JS thread, which is
  // exactly what invokeAsync does.
  crossnative::JSDispatcher dispatcher = [invoker](std::function<void()> work) {
    invoker->invokeAsync(
        [work = std::move(work)](jsi::Runtime &) mutable { work(); });
  };

  invoker->invokeAsync([core, dispatcher, resolve](jsi::Runtime &runtime) {
    crossnative::installCrossNative(runtime, core, dispatcher);
    resolve(@YES);
  });
}

- (void)invalidate
{
  auto invoker = [_callInvoker callInvoker];
  if (invoker != nullptr) {
    invoker->invokeAsync([](jsi::Runtime &runtime) {
      // Stops in-flight callbacks from touching a runtime that is going away.
      crossnative::uninstallCrossNative(runtime);
    });
  }
  _core.reset();
}

@end
