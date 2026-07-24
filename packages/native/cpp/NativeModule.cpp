#include "NativeModule.hpp"
#include "json.hpp"

#include <dlfcn.h>
#include <stdexcept>

namespace crossnative {

// --- WasmModule --------------------------------------------------------------

WasmModule::WasmModule(const std::string& id, const std::string& language,
                       WasmRuntime* runtime)
    : id_(id), language_(language), runtime_(runtime) {}

WasmModule::~WasmModule() {
  dispose();
}

std::vector<std::string> WasmModule::getFunctions() const {
  return runtime_ ? runtime_->getFunctions(id_) : std::vector<std::string>{};
}

std::string WasmModule::getManifest() const {
  return runtime_ ? runtime_->getManifest(id_) : "[]";
}

std::string WasmModule::call(const std::string& functionName,
                             const std::string& argsJson,
                             bool /*zeroCopy*/) {
  if (!runtime_) {
    return R"({"success":false,"error":"Module has been disposed"})";
  }
  return runtime_->call(id_, functionName, argsJson);
}

std::string WasmModule::callSync(const std::string& functionName,
                                 const std::string& argsJson) {
  return call(functionName, argsJson, false);
}

void WasmModule::dispose() {
  if (runtime_) {
    runtime_->unloadModule(id_);
    runtime_ = nullptr; // non-owning: detach, never delete
  }
}

// --- SharedLibraryModule -----------------------------------------------------

SharedLibraryModule::SharedLibraryModule(const std::string& id,
                                         const std::string& libraryPath)
    : id_(id), libraryPath_(libraryPath) {
  handle_ = dlopen(libraryPath.c_str(), RTLD_LAZY | RTLD_LOCAL);
  if (!handle_) {
    const char* err = dlerror();
    throw std::runtime_error("Failed to load library: " +
                             std::string(err ? err : "unknown error"));
  }

  callFunc_ = reinterpret_cast<CallFunc>(dlsym(handle_, "crossnative_call"));
  if (!callFunc_) {
    dlclose(handle_);
    handle_ = nullptr;
    throw std::runtime_error("Library missing 'crossnative_call' export");
  }
}

SharedLibraryModule::~SharedLibraryModule() {
  dispose();
}

std::vector<std::string> SharedLibraryModule::getFunctions() const {
  // Shared libraries do not advertise their exports through this ABI.
  return {};
}

std::string SharedLibraryModule::call(const std::string& functionName,
                                      const std::string& argsJson,
                                      bool zeroCopy) {
  if (!callFunc_) {
    return R"({"success":false,"error":"Library not loaded"})";
  }

  try {
    nlohmann::json request;
    request["function"] = functionName;
    request["args"] = nlohmann::json::parse(argsJson);
    request["zeroCopy"] = zeroCopy;

    const char* result = callFunc_(request.dump().c_str());
    if (!result) {
      return R"({"success":false,"error":"Library returned null"})";
    }
    return std::string(result);
  } catch (const std::exception& e) {
    nlohmann::json j;
    j["success"] = false;
    j["error"] = std::string("Exception: ") + e.what();
    return j.dump();
  }
}

std::string SharedLibraryModule::callSync(const std::string& functionName,
                                          const std::string& argsJson) {
  return call(functionName, argsJson, false);
}

void SharedLibraryModule::dispose() {
  if (handle_) {
    dlclose(handle_);
    handle_ = nullptr;
    callFunc_ = nullptr;
  }
}

} // namespace crossnative
