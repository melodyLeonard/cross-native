#include "CrossNativeJSI.hpp"

#include <atomic>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace crossnative {

namespace jsi = facebook::jsi;

namespace {

constexpr const char* kProxyName = "__CrossNativeProxy";

/// Everything one installed proxy needs, shared with its pending callbacks.
struct Installation {
  std::shared_ptr<CrossNative> core;
  JSDispatcher dispatcher;
  /// Cleared on uninstall so late callbacks do not touch a dead runtime.
  std::shared_ptr<std::atomic<bool>> alive =
      std::make_shared<std::atomic<bool>>(true);
};

std::mutex gInstallMutex;
std::unordered_map<jsi::Runtime*, std::shared_ptr<Installation>> gInstallations;

/// Builds a JS value on the JS thread, once the result is known.
using ValueFactory = std::function<jsi::Value(jsi::Runtime&)>;

/**
 * The resolve/reject pair of one Promise.
 *
 * Native work finishes on a worker thread, but jsi::Function may only be
 * touched on the JS thread, so settling always goes through the dispatcher.
 */
class Deferred : public std::enable_shared_from_this<Deferred> {
public:
  Deferred(jsi::Runtime& runtime, JSDispatcher dispatcher,
           std::shared_ptr<std::atomic<bool>> alive,
           std::shared_ptr<jsi::Function> resolve,
           std::shared_ptr<jsi::Function> reject)
      : runtime_(runtime),
        dispatcher_(std::move(dispatcher)),
        alive_(std::move(alive)),
        resolve_(std::move(resolve)),
        reject_(std::move(reject)) {}

  void resolve(ValueFactory factory) {
    settle(true, std::move(factory), {});
  }

  void reject(std::string message) {
    settle(false, nullptr, std::move(message));
  }

private:
  void settle(bool succeeded, ValueFactory factory, std::string message);

  jsi::Runtime& runtime_;
  JSDispatcher dispatcher_;
  std::shared_ptr<std::atomic<bool>> alive_;
  std::shared_ptr<jsi::Function> resolve_;
  std::shared_ptr<jsi::Function> reject_;
  std::atomic<bool> settled_{false};
};

void Deferred::settle(bool succeeded, ValueFactory factory, std::string message) {
  if (settled_.exchange(true)) return; // a Promise settles once

  // Keep this alive until the dispatched work has run.
  auto self = shared_from_this();
  dispatcher_([self, succeeded, factory = std::move(factory),
               message = std::move(message)]() mutable {
    if (!self->alive_->load()) return; // runtime went away

    jsi::Runtime& rt = self->runtime_;
    try {
      if (succeeded) {
        self->resolve_->call(rt, factory(rt));
      } else {
        auto error = rt.global()
            .getPropertyAsFunction(rt, "Error")
            .callAsConstructor(rt, jsi::String::createFromUtf8(rt, message));
        self->reject_->call(rt, error);
      }
    } catch (const jsi::JSIException&) {
      // The runtime is tearing down mid-settle; nothing useful to report.
    }
  });
}

// --- JSI helpers -------------------------------------------------------------

std::string toString(jsi::Runtime& rt, const jsi::Value* args, size_t count,
                     size_t index, const char* name) {
  if (index >= count || !args[index].isString()) {
    throw jsi::JSError(rt, std::string("CrossNative: '") + name +
                           "' must be a string");
  }
  return args[index].asString(rt).utf8(rt);
}

/// Copy an ArrayBuffer or a typed-array view into a byte vector.
std::vector<uint8_t> toBytes(jsi::Runtime& rt, const jsi::Value& value) {
  if (!value.isObject()) {
    throw jsi::JSError(rt, "CrossNative: expected an ArrayBuffer");
  }
  auto object = value.asObject(rt);

  if (object.isArrayBuffer(rt)) {
    auto buffer = object.getArrayBuffer(rt);
    return {buffer.data(rt), buffer.data(rt) + buffer.size(rt)};
  }

  // A typed array (Uint8Array and friends) wraps a buffer plus a window on it.
  if (object.hasProperty(rt, "buffer")) {
    auto buffer = object.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
    const size_t offset = object.hasProperty(rt, "byteOffset")
        ? static_cast<size_t>(object.getProperty(rt, "byteOffset").asNumber()) : 0;
    const size_t length = object.hasProperty(rt, "byteLength")
        ? static_cast<size_t>(object.getProperty(rt, "byteLength").asNumber())
        : buffer.size(rt) - offset;

    if (offset + length > buffer.size(rt)) {
      throw jsi::JSError(rt, "CrossNative: typed array is out of bounds");
    }
    return {buffer.data(rt) + offset, buffer.data(rt) + offset + length};
  }

  throw jsi::JSError(rt, "CrossNative: expected an ArrayBuffer or typed array");
}

jsi::Array toStringArray(jsi::Runtime& rt, const std::vector<std::string>& values) {
  jsi::Array array(rt, values.size());
  for (size_t i = 0; i < values.size(); ++i) {
    array.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, values[i]));
  }
  return array;
}

/// Create a Promise and hand its resolve/reject pair to `work`.
jsi::Value makePromise(jsi::Runtime& rt, const std::shared_ptr<Installation>& install,
                       std::function<void(std::shared_ptr<Deferred>)> work) {
  auto executor = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
      [install, work](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args,
                      size_t count) -> jsi::Value {
        if (count < 2) {
          throw jsi::JSError(rt, "CrossNative: bad Promise executor");
        }
        auto resolve = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        auto reject = std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));

        work(std::make_shared<Deferred>(rt, install->dispatcher, install->alive,
                                        std::move(resolve), std::move(reject)));
        return jsi::Value::undefined();
      });

  return rt.global()
      .getPropertyAsFunction(rt, "Promise")
      .callAsConstructor(rt, executor);
}

void defineFunction(jsi::Runtime& rt, jsi::Object& target, const char* name,
                    unsigned argCount, jsi::HostFunctionType fn) {
  target.setProperty(
      rt, name,
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, name), argCount, std::move(fn)));
}

// --- Proxy methods -----------------------------------------------------------

/// loadModuleFromBuffer(id, language, ArrayBuffer) -> Promise<boolean>
jsi::Value loadFromBuffer(jsi::Runtime& rt, const std::shared_ptr<Installation>& install,
                          const jsi::Value* args, size_t count) {
  auto moduleId = toString(rt, args, count, 0, "moduleId");
  auto language = toString(rt, args, count, 1, "language");
  if (count < 3) throw jsi::JSError(rt, "CrossNative: missing module bytes");
  auto bytes = toBytes(rt, args[2]);

  return makePromise(rt, install, [install, moduleId, language,
                                   bytes = std::move(bytes)](auto deferred) mutable {
    install->core->loadModuleFromBytesAsync(
        moduleId, language, std::move(bytes),
        [deferred](bool loaded, std::string error) {
          if (loaded) {
            deferred->resolve([](jsi::Runtime&) { return jsi::Value(true); });
          } else {
            deferred->reject(error.empty() ? "Failed to load module" : error);
          }
        });
  });
}

/// loadModule(id, language, path) -> Promise<boolean>
jsi::Value loadFromPath(jsi::Runtime& rt, const std::shared_ptr<Installation>& install,
                        const jsi::Value* args, size_t count) {
  auto moduleId = toString(rt, args, count, 0, "moduleId");
  auto language = toString(rt, args, count, 1, "language");
  auto path = toString(rt, args, count, 2, "path");

  return makePromise(rt, install, [install, moduleId, language, path](auto deferred) {
    // loadModule is future-based, so read the file here and reuse the async
    // byte path rather than blocking a thread on the future.
    auto bytes = readWasmFile(path);
    if (bytes.empty()) {
      deferred->reject("Could not read WASM file: " + path);
      return;
    }
    install->core->loadModuleFromBytesAsync(
        moduleId, language, std::move(bytes),
        [deferred](bool loaded, std::string error) {
          if (loaded) {
            deferred->resolve([](jsi::Runtime&) { return jsi::Value(true); });
          } else {
            deferred->reject(error.empty() ? "Failed to load module" : error);
          }
        });
  });
}

/// callFunction(id, name, argsJson, optionsJson) -> Promise<string>
jsi::Value callFunction(jsi::Runtime& rt, const std::shared_ptr<Installation>& install,
                        const jsi::Value* args, size_t count) {
  auto moduleId = toString(rt, args, count, 0, "moduleId");
  auto functionName = toString(rt, args, count, 1, "functionName");
  auto argsJson = toString(rt, args, count, 2, "argsJson");

  std::optional<CallOptions> options;
  if (count > 3 && args[3].isString()) {
    try {
      auto parsed = nlohmann::json::parse(args[3].asString(rt).utf8(rt));
      CallOptions parsedOptions;
      if (parsed.contains("priority") && parsed["priority"].is_number()) {
        parsedOptions.priority = parsed["priority"].get<int>();
      }
      if (parsed.contains("zeroCopy") && parsed["zeroCopy"].is_boolean()) {
        parsedOptions.zeroCopy = parsed["zeroCopy"].get<bool>();
      }
      options = parsedOptions;
    } catch (const std::exception&) {
      // Malformed options are not worth failing the call over; use defaults.
    }
  }

  return makePromise(rt, install, [install, moduleId, functionName, argsJson,
                                   options](auto deferred) {
    install->core->callFunctionAsync(
        moduleId, functionName, argsJson, options, [deferred](NativeResult result) {
          auto envelope = toEnvelopeJson(result);
          deferred->resolve([envelope = std::move(envelope)](jsi::Runtime& rt) {
            return jsi::String::createFromUtf8(rt, envelope);
          });
        });
  });
}

jsi::Value getStats(jsi::Runtime& rt, const std::shared_ptr<Installation>& install) {
  jsi::Object stats(rt);
  for (const auto& [key, value] : install->core->getStats()) {
    stats.setProperty(rt, jsi::PropNameID::forUtf8(rt, key), jsi::Value(value));
  }
  return stats;
}

/// Bind every proxy method onto a fresh object.
jsi::Object buildProxy(jsi::Runtime& rt, const std::shared_ptr<Installation>& install) {
  jsi::Object proxy(rt);

  defineFunction(rt, proxy, "loadModuleFromBuffer", 3,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        return loadFromBuffer(rt, install, a, n);
      });

  defineFunction(rt, proxy, "loadModule", 3,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        return loadFromPath(rt, install, a, n);
      });

  defineFunction(rt, proxy, "callFunction", 4,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        return callFunction(rt, install, a, n);
      });

  defineFunction(rt, proxy, "getModuleFunctions", 1,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        return toStringArray(rt, install->core->getModuleFunctions(
            toString(rt, a, n, 0, "moduleId")));
      });

  defineFunction(rt, proxy, "isModuleLoaded", 1,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        return jsi::Value(install->core->isModuleLoaded(
            toString(rt, a, n, 0, "moduleId")));
      });

  defineFunction(rt, proxy, "unloadModule", 1,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        install->core->unloadModule(toString(rt, a, n, 0, "moduleId"));
        return jsi::Value::undefined();
      });

  defineFunction(rt, proxy, "getStats", 0,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
        return getStats(rt, install);
      });

  defineFunction(rt, proxy, "setLogLevel", 1,
      [install](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
        install->core->setLogLevel(toString(rt, a, n, 0, "level"));
        return jsi::Value::undefined();
      });

  return proxy;
}

} // namespace

void installCrossNative(jsi::Runtime& runtime, std::shared_ptr<CrossNative> core,
                        JSDispatcher dispatcher) {
  auto install = std::make_shared<Installation>();
  install->core = std::move(core);
  install->dispatcher = std::move(dispatcher);

  {
    std::lock_guard<std::mutex> lock(gInstallMutex);
    // Replacing an existing install invalidates its pending callbacks.
    auto existing = gInstallations.find(&runtime);
    if (existing != gInstallations.end()) {
      existing->second->alive->store(false);
    }
    gInstallations[&runtime] = install;
  }

  runtime.global().setProperty(runtime, kProxyName, buildProxy(runtime, install));
}

void uninstallCrossNative(jsi::Runtime& runtime) {
  {
    std::lock_guard<std::mutex> lock(gInstallMutex);
    auto it = gInstallations.find(&runtime);
    if (it == gInstallations.end()) return;
    it->second->alive->store(false);
    gInstallations.erase(it);
  }

  runtime.global().setProperty(runtime, kProxyName, jsi::Value::undefined());
}

} // namespace crossnative
