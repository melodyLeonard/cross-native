#include "CrossNative.hpp"
#include "json.hpp"
#include <chrono>

namespace crossnative {

namespace {

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

CrossNative::CrossNative()
  : wasmRuntime_(std::make_unique<WasmRuntime>()),
    threadPool_(std::make_unique<ThreadPool>(
      std::thread::hardware_concurrency()
    )) {
  log(LogLevel::INFO, "CrossNative initialized with " +
      std::to_string(std::thread::hardware_concurrency()) + " threads");
}

CrossNative::~CrossNative() {
  std::lock_guard<std::mutex> lock(modulesMutex_);
  for (auto& [id, module] : modules_) {
    module->dispose();
  }
  modules_.clear();
  log(LogLevel::INFO, "CrossNative destroyed");
}

std::future<bool> CrossNative::loadModule(
    const std::string& moduleId,
    const std::string& language,
    const std::string& sourcePath) {
  return threadPool_->enqueue(TaskPriority::HIGH, [this, moduleId, language, sourcePath]() -> bool {
    try {
      log(LogLevel::INFO, "Loading module: " + moduleId + " (" + language + ")");
      std::shared_ptr<NativeModule> module;

      if (language == "wasm" || language == "rust" || language == "go" ||
          language == "zig" || language == "assemblyscript") {
        // By this point the CLI has already compiled the source to WASM.
        auto wasmBytes = readWasmFile(sourcePath);
        if (wasmBytes.empty()) {
          throw std::runtime_error("Could not read WASM file: " + sourcePath);
        }

        std::string error;
        if (!wasmRuntime_->loadModule(moduleId, wasmBytes, &error)) {
          throw std::runtime_error(error);
        }

        module = std::make_shared<WasmModule>(moduleId, language, wasmRuntime_.get());
      } else if (language == "cpp" || language == "c++") {
        module = loadSharedLibrary(moduleId, sourcePath);
        if (!module) {
          throw std::runtime_error("Could not load shared library: " + sourcePath);
        }
      } else {
        throw std::runtime_error("Unsupported language: " + language);
      }

      std::lock_guard<std::mutex> lock(modulesMutex_);
      modules_[moduleId] = module;
      log(LogLevel::INFO, "Module loaded: " + moduleId + " (" +
          std::to_string(module->getFunctions().size()) + " exported functions)");
      return true;
    } catch (const std::exception& e) {
      log(LogLevel::ERROR, "Failed to load module " + moduleId + ": " + e.what());
      return false;
    }
  });
}

std::future<NativeResult> CrossNative::callFunction(
    const std::string& moduleId,
    const std::string& functionName,
    const std::string& argsJson,
    const std::optional<CallOptions>& options) {
  TaskPriority priority = TaskPriority::NORMAL;
  int timeoutMs = 30000;
  bool zeroCopy = false;
  if (options.has_value()) {
    if (options->priority.has_value()) priority = static_cast<TaskPriority>(options->priority.value());
    if (options->timeout.has_value()) timeoutMs = options->timeout.value();
    if (options->zeroCopy.has_value()) zeroCopy = options->zeroCopy.value();
  }
  return threadPool_->enqueue(priority, [this, moduleId, functionName, argsJson, zeroCopy]() -> NativeResult {
    auto startTime = std::chrono::high_resolution_clock::now();
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
      auto endTime = std::chrono::high_resolution_clock::now();
      auto executionTime = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;

      auto result = unwrapEnvelope(envelope);
      result.metrics = {.executionTime = executionTime, .queueTime = 0, .threadId = std::to_string(std::hash<std::thread::id>{}(std::this_thread::get_id()))};
      return result;
    } catch (const std::exception& e) {
      return {.success = false, .error = std::string("Exception: ") + e.what()};
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
    log(LogLevel::INFO, "Module unloaded: " + moduleId);
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
  if (level == "debug") logLevel_ = LogLevel::DEBUG;
  else if (level == "info") logLevel_ = LogLevel::INFO;
  else if (level == "warn") logLevel_ = LogLevel::WARN;
  else if (level == "error") logLevel_ = LogLevel::ERROR;
}

void CrossNative::log(LogLevel level, const std::string& message) {
  if (level < logLevel_) return;
  std::string prefix;
  switch (level) {
    case LogLevel::DEBUG: prefix = "[DEBUG]"; break;
    case LogLevel::INFO: prefix = "[INFO]"; break;
    case LogLevel::WARN: prefix = "[WARN]"; break;
    case LogLevel::ERROR: prefix = "[ERROR]"; break;
  }
  // stderr, not stdout: hosts embedding this library use stdout as a data
  // channel, and log lines would corrupt it.
  std::cerr << "[CrossNative]" << prefix << " " << message << std::endl;
}

} // namespace crossnative
