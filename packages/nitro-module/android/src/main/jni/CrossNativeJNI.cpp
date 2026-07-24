// JNI entry point for the Android build.
//
// Mirrors ios/CrossNativeModule.mm: the only platform-specific job is reaching
// the JavaScript runtime and providing a way to schedule work back onto it.
// Everything below that is the shared C++ core.

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvokerHolder.h>

#include <chrono>
#include <future>
#include <memory>
#include <mutex>

#include "CrossNativeJSI.hpp"

using namespace facebook;

namespace {

/// How long to wait for the JS thread to run the install before giving up.
constexpr auto kInstallTimeout = std::chrono::seconds(10);

std::mutex gCoreMutex;
std::shared_ptr<crossnative::CrossNative> gCore;

/// One core per process, kept alive so loaded modules survive between calls.
std::shared_ptr<crossnative::CrossNative> sharedCore() {
  std::lock_guard<std::mutex> lock(gCoreMutex);
  if (!gCore) {
    gCore = std::make_shared<crossnative::CrossNative>();
  }
  return gCore;
}

} // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return jni::initialize(vm, [] {});
}

/**
 * Install globalThis.__CrossNativeProxy.
 *
 * Called from the native-modules thread. The install itself has to happen on
 * the JS thread, so it is scheduled through the CallInvoker and this thread
 * waits for it — that way the Promise on the Java side resolves only once the
 * proxy actually exists, matching the iOS behaviour.
 *
 * @return true if the proxy was installed
 */
extern "C" JNIEXPORT jboolean JNICALL
Java_com_crossnative_CrossNativeModule_nativeInstall(JNIEnv*, jclass,
                                                     jobject callInvokerHolder) {
  auto holder = jni::alias_ref<react::CallInvokerHolder::javaobject>(
      static_cast<react::CallInvokerHolder::javaobject>(callInvokerHolder));

  auto invoker = holder->cthis()->getCallInvoker();
  if (!invoker) {
    return JNI_FALSE;
  }

  crossnative::JSDispatcher dispatcher = [invoker](std::function<void()> work) {
    invoker->invokeAsync(
        [work = std::move(work)](jsi::Runtime&) mutable { work(); });
  };

  // Shared rather than captured by reference: if the wait below times out this
  // function returns, and the scheduled lambda must not touch a dead promise.
  auto installed = std::make_shared<std::promise<void>>();
  auto future = installed->get_future();
  auto core = sharedCore();

  invoker->invokeAsync([core, dispatcher, installed](jsi::Runtime& runtime) {
    crossnative::installCrossNative(runtime, core, dispatcher);
    installed->set_value();
  });

  return future.wait_for(kInstallTimeout) == std::future_status::ready
      ? JNI_TRUE
      : JNI_FALSE;
}
