#pragma once

#include "../cpp/CrossNative.hpp"

#include <jsi/jsi.h>

#include <functional>
#include <memory>

namespace crossnative {

/**
 * Schedules a callback onto the JavaScript thread.
 *
 * Platform glue supplies this, backed by React Native's CallInvoker. Keeping it
 * a plain std::function means this layer needs no React headers beyond JSI, so
 * it stays portable across iOS, Android and any other JSI host.
 */
using JSDispatcher = std::function<void(std::function<void()>)>;

/**
 * Install `globalThis.__CrossNativeProxy`.
 *
 * The object exposes:
 *
 *   loadModuleFromBuffer(id, language, ArrayBuffer) -> Promise<boolean>
 *   loadModule(id, language, path)                  -> Promise<boolean>
 *   callFunction(id, name, argsJson, optionsJson)   -> Promise<string>
 *   getModuleFunctions(id)                          -> string[]
 *   isModuleLoaded(id)                              -> boolean
 *   unloadModule(id)                                -> void
 *   getStats()                                      -> object
 *   setLogLevel(level)                              -> void
 *
 * Arguments and results cross as JSON strings, matching the protocol the
 * TypeScript JSIBackend already speaks.
 *
 * Must be called on the JavaScript thread.
 *
 * @param runtime    The JS runtime to install into
 * @param core       The shared CrossNative instance
 * @param dispatcher Schedules work back onto the JS thread
 */
void installCrossNative(facebook::jsi::Runtime& runtime,
                        std::shared_ptr<CrossNative> core,
                        JSDispatcher dispatcher);

/**
 * Remove the proxy and drop the references it holds.
 *
 * Call this when the runtime is being torn down (a reload in development, for
 * instance) so in-flight callbacks stop trying to touch a dead runtime.
 */
void uninstallCrossNative(facebook::jsi::Runtime& runtime);

} // namespace crossnative
