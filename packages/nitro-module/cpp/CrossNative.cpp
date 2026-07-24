#include "CrossNative.hpp"
#include "json.hpp"
#include <chrono>

namespace crossnative {

namespace {

/// Languages that reach the runtime as a WASM binary.
bool isWasmLanguage(const std::string& language) {
  return language == "wasm" || language == "rust" || language == "go" ||
         language == "zig" || language == "assemblyscript";
}

/**
 * Unpack the runtime's JSON envelope into a NativeResult.
 *
 * The runtime returns {"success":bool,"result":...,"outputs":[...]} or
 * {"success":false,"error":"..."}. Without unpacking, a failed WASM call would
 * surface as a *successful* native call carrying an error payload.
 */
NativeResult unwrapEnvelope(const std::string& envelope) {
  NativeResult out;
  try {
    auto j = nlohmann::json::parse(envelope);
    out.success = j.value("success", false);
    if (out.success) {
      nlohmann::json payload;
      payload["result"] = j.value("result", nlohmann::json());
      payload["outputs"] = j.value("outputs", nlohmann::json::array());
      out.data = payload.dump();
    } else {
      out.error = j.value("error", "Unknown error");
    }
  } catch (const std::exception& e) {
    out.success = false;
    out.error = std::string("Malformed result from module: ") + e.what();
  }
  return out;
}

} // namespace

std::string toEnvelopeJson(const NativeResult& result) {
  nlohmann::json j;
  j["success"] = result.success;

  if (!result.success) {
    j["error"] = result.error;
    return j.dump();
  }

  try {
    auto payload = nlohmann::json::parse(result.data);
    j["result"] = payload.value("result", nlohmann::json());
    j["outputs"] = payload.value("outputs", nlohmann::json::array());
  } catch (const std::exception& e) {
    j["success"] = false;
    j["error"] = std::string("Malformed payload: ") + e.what();
    return j.dump();
  }

  j["metrics"] = {
    {"executionTime", result.metrics.executionTime},
    {"queueTime", result.metrics.queueTime},
    {"threadId", result.metrics.threadId},
  };
  return j.dump();
}

CrossNative::CrossNative()
  : wasmRuntime_(std::make_unique<WasmRuntime>()),
    threadPool_(std::make_unique<ThreadPool>(
      std::thread::hardware_concurrency()
    )) {
  log(LogLevel::Info, "CrossNative initialized with " +
      std::to_string(std::thread::hardware_concurrency()) + " threads");
}

CrossNative::~CrossNative() {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  for (auto& [id, module] : modules_) {
    module->dispose();
  }
  modules_.clear();
  log(LogLevel::Info, "CrossNative destroyed");
}

std::future<bool> CrossNative::loadModule(
    const std::string& moduleId,
    const std::string& language,
    const std::string& sourcePath) {
  return threadPool_->enqueue(TaskPriority::HIGH, [this, moduleId, language, sourcePath]() -> bool {
    try {
      log(LogLevel::Info, "Loading module: " + moduleId + " (" + language + ")");

      if (isWasmLanguage(language)) {
        // The source has already been compiled to WASM by this point.
        auto wasmBytes = readWasmFile(sourcePath);
        if (wasmBytes.empty()) {
          throw std::runtime_error("Could not read WASM file: " + sourcePath);
        }
        installWasmModule(moduleId, language, wasmBytes);
      } else if (language == "cpp" || language == "c++") {
        installSharedLibrary(moduleId, sourcePath);
      } else {
        throw std::runtime_error("Unsupported language: " + language);
      }
      return true;
    } catch (const std::exception& e) {
      log(LogLevel::Error, "Failed to load module " + moduleId + ": " + e.what());
      return false;
    }
  });
}

std::future<bool> CrossNative::loadModuleFromBytes(
    const std::string& moduleId,
    const std::string& language,
    std::vector<uint8_t> wasmBytes) {
  return threadPool_->enqueue(
      TaskPriority::HIGH,
      [this, moduleId, language, bytes = std::move(wasmBytes)]() -> bool {
        try {
          log(LogLevel::Info, "Loading module from bytes: " + moduleId +
              " (" + language + ", " + std::to_string(bytes.size()) + " bytes)");

          if (!isWasmLanguage(language)) {
            throw std::runtime_error(
                "Only WASM languages can be loaded from bytes, got: " + language);
          }
          installWasmModule(moduleId, language, bytes);
          return true;
        } catch (const std::exception& e) {
          log(LogLevel::Error, "Failed to load module " + moduleId + ": " + e.what());
          return false;
        }
      });
}

void CrossNative::installWasmModule(const std::string& moduleId,
                                    const std::string& language,
                                    const std::vector<uint8_t>& wasmBytes) {
  std::string error;
  if (!wasmRuntime_->loadModule(moduleId, wasmBytes, &error)) {
    throw std::runtime_error(error);
  }
  registerModule(moduleId,
                 std::make_shared<WasmModule>(moduleId, language, wasmRuntime_.get()));
}

void CrossNative::installSharedLibrary(const std::string& moduleId,
                                       const std::string& libraryPath) {
  auto module = loadSharedLibrary(moduleId, libraryPath);
  if (!module) {
    throw std::runtime_error("Could not load shared library: " + libraryPath);
  }
  registerModule(moduleId, std::move(module));
}

void CrossNative::registerModule(const std::string& moduleId,
                                 std::shared_ptr<NativeModule> module) {
  const size_t functionCount = module->getFunctions().size();
  {
    std::lock_guard<std::mutex> lock(modulesMutex_);
    modules_[moduleId] = std::move(module);
  }
  log(LogLevel::Info, "Module loaded: " + moduleId + " (" +
      std::to_string(functionCount) + " exported functions)");
}

/// Priority and zero-copy flag for one call, with defaults applied.
CrossNative::CallSettings CrossNative::resolveSettings(
    const std::optional<CallOptions>& options) {
  CallSettings settings;
  if (!options.has_value()) return settings;

  if (options->priority.has_value()) {
    settings.priority = static_cast<TaskPriority>(options->priority.value());
  }
  if (options->zeroCopy.has_value()) {
    settings.zeroCopy = options->zeroCopy.value();
  }
  return settings;
}

NativeResult CrossNative::executeCall(const std::string& moduleId,
                                      const std::string& functionName,
                                      const std::string& argsJson,
                                      bool zeroCopy) {
  const auto startTime = std::chrono::high_resolution_clock::now();

  try {
    std::shared_ptr<NativeModule> module;
    {
      std::lock_guard<std::mutex> lock(modulesMutex_);
      auto it = modules_.find(moduleId);
      if (it == modules_.end()) {
        return {.success = false, .error = "Module not found: " + moduleId};
      }
      module = it->second;
    }

    auto envelope = module->call(functionName, argsJson, zeroCopy);
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::high_resolution_clock::now() - startTime).count() / 1000.0;

    auto result = unwrapEnvelope(envelope);
    result.metrics = {
      .executionTime = elapsed,
      .queueTime = 0,
      .threadId = std::to_string(
          std::hash<std::thread::id>{}(std::this_thread::get_id())),
    };
    return result;
  } catch (const std::exception& e) {
    return {.success = false, .error = std::string("Exception: ") + e.what()};
  }
}

std::future<NativeResult> CrossNative::callFunction(
    const std::string& moduleId,
    const std::string& functionName,
    const std::string& argsJson,
    const std::optional<CallOptions>& options) {
  const auto settings = resolveSettings(options);

  return threadPool_->enqueue(
      settings.priority,
      [this, moduleId, functionName, argsJson, zeroCopy = settings.zeroCopy] {
        return executeCall(moduleId, functionName, argsJson, zeroCopy);
      });
}

void CrossNative::callFunctionAsync(
    const std::string& moduleId,
    const std::string& functionName,
    const std::string& argsJson,
    const std::optional<CallOptions>& options,
    std::function<void(NativeResult)> callback) {
  const auto settings = resolveSettings(options);

  // The callback runs on the worker that did the work, so no thread has to sit
  // waiting on a future just to deliver the result.
  threadPool_->enqueue(
      settings.priority,
      [this, moduleId, functionName, argsJson,
       zeroCopy = settings.zeroCopy, callback = std::move(callback)] {
        callback(executeCall(moduleId, functionName, argsJson, zeroCopy));
      });
}

void CrossNative::loadModuleFromBytesAsync(
    const std::string& moduleId,
    const std::string& language,
    std::vector<uint8_t> wasmBytes,
    std::function<void(bool, std::string)> callback) {
  threadPool_->enqueue(
      TaskPriority::HIGH,
      [this, moduleId, language, bytes = std::move(wasmBytes),
       callback = std::move(callback)] {
        try {
          if (!isWasmLanguage(language)) {
            throw std::runtime_error(
                "Only WASM languages can be loaded from bytes, got: " + language);
          }
          installWasmModule(moduleId, language, bytes);
          callback(true, "");
        } catch (const std::exception& e) {
          log(LogLevel::Error, "Failed to load module " + moduleId + ": " + e.what());
          callback(false, e.what());
        }
      });
}

NativeResult CrossNative::callFunctionSync(
    const std::string& moduleId,
    const std::string& functionName,
    const std::string& argsJson) {
  std::shared_ptr<NativeModule> module;
  {
    std::lock_guard<std::mutex> lock(modulesMutex_);
    auto it = modules_.find(moduleId);
    if (it == modules_.end()) {
      return {.success = false, .error = "Module not found: " + moduleId};
    }
    module = it->second;
  }
  try {
    return unwrapEnvelope(module->callSync(functionName, argsJson));
  } catch (const std::exception& e) {
    return {.success = false, .error = std::string("Exception: ") + e.what()};
  }
}

void CrossNative::unloadModule(const std::string& moduleId) {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  auto it = modules_.find(moduleId);
  if (it != modules_.end()) {
    it->second->dispose();
    modules_.erase(it);
    log(LogLevel::Info, "Module unloaded: " + moduleId);
  }
}

bool CrossNative::isModuleLoaded(const std::string& moduleId) {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  return modules_.find(moduleId) != modules_.end();
}

std::vector<std::string> CrossNative::getModuleFunctions(const std::string& moduleId) {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  auto it = modules_.find(moduleId);
  if (it != modules_.end()) {
    return it->second->getFunctions();
  }
  return {};
}

std::string CrossNative::getModuleManifest(const std::string& moduleId) {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  auto it = modules_.find(moduleId);
  return it != modules_.end() ? it->second->getManifest() : "[]";
}

std::string CrossNative::createSharedBuffer(size_t size) {
  std::lock_guard<std::mutex> lock(buffersMutex_);
  std::string bufferId = "buffer_" + std::to_string(nextBufferId_++);
  buffers_[bufferId] = std::make_shared<SharedBuffer>(size);
  return bufferId;
}

void CrossNative::releaseSharedBuffer(const std::string& bufferId) {
  std::lock_guard<std::mutex> lock(buffersMutex_);
  buffers_.erase(bufferId);
}

std::unordered_map<std::string, double> CrossNative::getStats() {
  std::unordered_map<std::string, double> stats;
  stats["thread_pool_size"] = static_cast<double>(threadPool_->size());
  stats["active_threads"] = static_cast<double>(threadPool_->activeCount());
  stats["queue_size"] = static_cast<double>(threadPool_->queueSize());
  {
    std::lock_guard<std::mutex> lock(modulesMutex_);
    stats["loaded_modules"] = static_cast<double>(modules_.size());
  }
  {
    std::lock_guard<std::mutex> lock(buffersMutex_);
    stats["active_buffers"] = static_cast<double>(buffers_.size());
  }
  return stats;
}

void CrossNative::setLogLevel(const std::string& level) {
  if (level == "debug") logLevel_ = LogLevel::Debug;
  else if (level == "info") logLevel_ = LogLevel::Info;
  else if (level == "warn") logLevel_ = LogLevel::Warn;
  else if (level == "error") logLevel_ = LogLevel::Error;
}

void CrossNative::log(LogLevel level, const std::string& message) {
  if (level < logLevel_) return;
  std::string prefix;
  switch (level) {
    case LogLevel::Debug: prefix = "[DEBUG]"; break;
    case LogLevel::Info: prefix = "[INFO]"; break;
    case LogLevel::Warn: prefix = "[WARN]"; break;
    case LogLevel::Error: prefix = "[ERROR]"; break;
  }
  // stderr, not stdout: hosts embedding this library use stdout as a data
  // channel, and log lines would corrupt it.
  std::cerr << "[CrossNative]" << prefix << " " << message << std::endl;
}

} // namespace crossnative
