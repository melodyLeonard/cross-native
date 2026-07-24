#include "WasmRuntime.hpp"
#include "NativeModule.hpp"
#include "wasm3.h"
#include "json.hpp"

#include <cstdio>
#include <cstring>
#include <mutex>

namespace crossnative {

using json = nlohmann::json;

namespace {

/// wasm3 value stack size per module. Large enough for deeply recursive
/// functions (fibonacci(30) and friends) without being wasteful on mobile.
constexpr uint32_t kStackSizeBytes = 512 * 1024;

/// Names of the allocator exports a module must provide to accept buffer args.
constexpr const char* kAllocFn = "cn_alloc";
constexpr const char* kFreeFn = "cn_free";

json errorResult(const std::string& message) {
  json j;
  j["success"] = false;
  j["error"] = message;
  return j;
}

// --- WASM binary parsing -----------------------------------------------------
// wasm3 has no public API for enumerating a module's exports, so we parse the
// export section straight out of the binary. The format is stable and simple:
// https://webassembly.github.io/spec/core/binary/modules.html#export-section

/// Decode an unsigned LEB128 value. Returns false if the buffer runs out.
bool readLEB128(const uint8_t* data, size_t size, size_t& pos, uint32_t& out) {
  uint32_t result = 0;
  uint32_t shift = 0;

  while (pos < size) {
    uint8_t byte = data[pos++];
    result |= static_cast<uint32_t>(byte & 0x7F) << shift;
    if ((byte & 0x80) == 0) {
      out = result;
      return true;
    }
    shift += 7;
    if (shift > 31) return false; // overflow
  }
  return false;
}

/// Read the entries of an export section, appending function names to `out`.
void readExportEntries(const uint8_t* data, size_t size, size_t pos,
                       size_t sectionEnd, std::vector<std::string>& out) {
  uint32_t count = 0;
  if (!readLEB128(data, size, pos, count)) return;

  for (uint32_t i = 0; i < count && pos < sectionEnd; ++i) {
    uint32_t nameLen = 0;
    if (!readLEB128(data, size, pos, nameLen)) return;
    if (pos + nameLen > sectionEnd) return;

    std::string name(reinterpret_cast<const char*>(data + pos), nameLen);
    pos += nameLen;

    if (pos >= sectionEnd) return;
    uint8_t kind = data[pos++];

    uint32_t index = 0;
    if (!readLEB128(data, size, pos, index)) return;

    if (kind == 0) { // function export
      out.push_back(std::move(name));
    }
  }
}

/// Extract exported function names from a WASM binary.
std::vector<std::string> parseExportedFunctions(const std::vector<uint8_t>& wasm) {
  std::vector<std::string> functions;
  const uint8_t* data = wasm.data();
  const size_t size = wasm.size();

  // Magic "\0asm" + version, 8 bytes total.
  if (size < 8 || std::memcmp(data, "\0asm", 4) != 0) return functions;

  size_t pos = 8;
  while (pos < size) {
    uint8_t sectionId = data[pos++];
    uint32_t sectionSize = 0;
    if (!readLEB128(data, size, pos, sectionSize)) break;

    const size_t sectionEnd = pos + sectionSize;
    if (sectionEnd > size) break;

    if (sectionId == 7) { // export section; there is only ever one
      readExportEntries(data, size, pos, sectionEnd, functions);
      break;
    }
    pos = sectionEnd;
  }

  return functions;
}

// --- Buffer element types ----------------------------------------------------

enum class ElemKind { F64, F32, I32, U32, I64, U64, I8, U8, I16, U16 };

bool parseElemKind(const std::string& name, ElemKind& kind, size_t& elemSize) {
  if (name == "f64") { kind = ElemKind::F64; elemSize = 8; return true; }
  if (name == "f32") { kind = ElemKind::F32; elemSize = 4; return true; }
  if (name == "i32") { kind = ElemKind::I32; elemSize = 4; return true; }
  if (name == "u32") { kind = ElemKind::U32; elemSize = 4; return true; }
  if (name == "i64") { kind = ElemKind::I64; elemSize = 8; return true; }
  if (name == "u64") { kind = ElemKind::U64; elemSize = 8; return true; }
  if (name == "i8")  { kind = ElemKind::I8;  elemSize = 1; return true; }
  if (name == "u8")  { kind = ElemKind::U8;  elemSize = 1; return true; }
  if (name == "i16") { kind = ElemKind::I16; elemSize = 2; return true; }
  if (name == "u16") { kind = ElemKind::U16; elemSize = 2; return true; }
  return false;
}

void writeElem(uint8_t* dst, ElemKind kind, const json& value) {
  switch (kind) {
    case ElemKind::F64: { double v = value.get<double>();     std::memcpy(dst, &v, 8); break; }
    case ElemKind::F32: { float v = value.get<float>();       std::memcpy(dst, &v, 4); break; }
    case ElemKind::I32: { int32_t v = value.get<int32_t>();   std::memcpy(dst, &v, 4); break; }
    case ElemKind::U32: { uint32_t v = value.get<uint32_t>(); std::memcpy(dst, &v, 4); break; }
    case ElemKind::I64: { int64_t v = value.get<int64_t>();   std::memcpy(dst, &v, 8); break; }
    case ElemKind::U64: { uint64_t v = value.get<uint64_t>(); std::memcpy(dst, &v, 8); break; }
    case ElemKind::I8:  { int8_t v = value.get<int8_t>();     std::memcpy(dst, &v, 1); break; }
    case ElemKind::U8:  { uint8_t v = value.get<uint8_t>();   std::memcpy(dst, &v, 1); break; }
    case ElemKind::I16: { int16_t v = value.get<int16_t>();   std::memcpy(dst, &v, 2); break; }
    case ElemKind::U16: { uint16_t v = value.get<uint16_t>(); std::memcpy(dst, &v, 2); break; }
  }
}

json readElem(const uint8_t* src, ElemKind kind) {
  switch (kind) {
    case ElemKind::F64: { double v;   std::memcpy(&v, src, 8); return v; }
    case ElemKind::F32: { float v;    std::memcpy(&v, src, 4); return v; }
    case ElemKind::I32: { int32_t v;  std::memcpy(&v, src, 4); return v; }
    case ElemKind::U32: { uint32_t v; std::memcpy(&v, src, 4); return v; }
    case ElemKind::I64: { int64_t v;  std::memcpy(&v, src, 8); return v; }
    case ElemKind::U64: { uint64_t v; std::memcpy(&v, src, 8); return v; }
    case ElemKind::I8:  { int8_t v;   std::memcpy(&v, src, 1); return v; }
    case ElemKind::U8:  { uint8_t v;  std::memcpy(&v, src, 1); return v; }
    case ElemKind::I16: { int16_t v;  std::memcpy(&v, src, 2); return v; }
    case ElemKind::U16: { uint16_t v; std::memcpy(&v, src, 2); return v; }
  }
  return nullptr;
}

// --- Loaded modules ----------------------------------------------------------

/// One module loaded into its own runtime.
struct ModuleEntry {
  /// wasm3 keeps a pointer into these bytes, so they must outlive the module.
  std::vector<uint8_t> bytes;
  IM3Runtime runtime = nullptr;
  std::vector<std::string> functions;
  /// wasm3 runtimes are not thread-safe; serialise calls into this module.
  std::mutex callMutex;

  ~ModuleEntry() {
    // Freeing the runtime also frees the module loaded into it.
    if (runtime) m3_FreeRuntime(runtime);
  }
};

/// Call the module's exported allocator. Caller must hold entry.callMutex.
bool wasmAlloc(ModuleEntry& entry, uint32_t size, uint32_t& outPtr, std::string& error) {
  IM3Function allocFn = nullptr;
  if (m3_FindFunction(&allocFn, entry.runtime, kAllocFn) || !allocFn) {
    error = "Module does not export '" + std::string(kAllocFn) +
            "', which is required to pass array arguments";
    return false;
  }

  int32_t sizeArg = static_cast<int32_t>(size);
  const void* args[1] = {&sizeArg};
  if (M3Result r = m3_Call(allocFn, 1, args)) {
    error = std::string("cn_alloc failed: ") + r;
    return false;
  }

  int32_t ptr = 0;
  const void* rets[1] = {&ptr};
  if (M3Result r = m3_GetResults(allocFn, 1, rets)) {
    error = std::string("cn_alloc returned no value: ") + r;
    return false;
  }
  if (ptr == 0) {
    error = "cn_alloc returned null (out of WASM memory?)";
    return false;
  }

  outPtr = static_cast<uint32_t>(ptr);
  return true;
}

/// Call the module's exported deallocator. Best-effort; failures are ignored.
void wasmFree(ModuleEntry& entry, uint32_t ptr, uint32_t size) {
  IM3Function freeFn = nullptr;
  if (m3_FindFunction(&freeFn, entry.runtime, kFreeFn) || !freeFn) return;

  int32_t ptrArg = static_cast<int32_t>(ptr);
  int32_t sizeArg = static_cast<int32_t>(size);
  const void* args[2] = {&ptrArg, &sizeArg};
  m3_Call(freeFn, 2, args);
}

// --- Argument binding --------------------------------------------------------

/// What a buffer-shaped argument asked for.
struct BufferSpec {
  ElemKind kind = ElemKind::F64;
  size_t elemSize = 0;
  size_t count = 0;
  /// Values to copy in, or null for a pure output buffer.
  const json* values = nullptr;
  /// Whether the contents should be read back after the call.
  bool readBack = false;
};

/// Interpret {"in"|"out"|"inout": ..., "type": "f64"}.
bool parseBufferSpec(const json& arg, BufferSpec& spec, std::string& error) {
  const bool isIn = arg.contains("in");
  const bool isOut = arg.contains("out");
  const bool isInOut = arg.contains("inout");

  if (!isIn && !isOut && !isInOut) {
    error = "buffer argument must contain 'in', 'out' or 'inout'";
    return false;
  }

  if (!parseElemKind(arg.value("type", "f64"), spec.kind, spec.elemSize)) {
    error = "unsupported buffer element type: " + arg.value("type", "f64");
    return false;
  }

  if (isOut) {
    if (!arg["out"].is_number_unsigned()) {
      error = "'out' must be an element count";
      return false;
    }
    spec.count = arg["out"].get<size_t>();
  } else {
    spec.values = isIn ? &arg["in"] : &arg["inout"];
    if (!spec.values->is_array()) {
      error = "'in'/'inout' must be an array";
      return false;
    }
    spec.count = spec.values->size();
  }

  spec.readBack = isOut || isInOut;
  if (spec.count == 0) {
    error = "buffer argument is empty";
    return false;
  }
  return true;
}

/// A buffer allocated inside WASM memory for the duration of one call.
struct Allocation {
  uint32_t ptr = 0;
  uint32_t byteSize = 0;
  size_t count = 0;
  size_t elemSize = 0;
  ElemKind kind = ElemKind::F64;
  bool readBack = false;
};

/**
 * Marshals one call's arguments into a WASM function's parameter slots, owning
 * any WASM-side allocations for the duration of the call.
 */
class ArgumentBinder {
public:
  explicit ArgumentBinder(ModuleEntry& entry) : entry_(entry) {}

  /// Frees every buffer allocated for this call, whatever the outcome.
  ~ArgumentBinder() {
    for (const auto& a : allocations_) wasmFree(entry_, a.ptr, a.byteSize);
  }

  ArgumentBinder(const ArgumentBinder&) = delete;
  ArgumentBinder& operator=(const ArgumentBinder&) = delete;

  bool bind(IM3Function func, const json& args, std::string& error);
  bool readOutputs(json& outputs, std::string& error) const;

  uint32_t count() const { return static_cast<uint32_t>(pointers_.size()); }
  const void** pointers() { return pointers_.data(); }

private:
  bool bindScalar(const json& arg, M3ValueType type, void* slot, std::string& error);
  bool bindBuffer(const json& arg, M3ValueType type, void* slot, std::string& error);

  ModuleEntry& entry_;
  /// Pre-sized so it never reallocates while pointers_ points into it.
  std::vector<uint64_t> store_;
  std::vector<const void*> pointers_;
  std::vector<Allocation> allocations_;
};

bool ArgumentBinder::bind(IM3Function func, const json& args, std::string& error) {
  const uint32_t argCount = m3_GetArgCount(func);
  if (args.size() != argCount) {
    error = "argument count mismatch: WASM expects " + std::to_string(argCount) +
            ", got " + std::to_string(args.size());
    return false;
  }

  store_.assign(argCount, 0);
  pointers_.assign(argCount, nullptr);

  for (uint32_t i = 0; i < argCount; ++i) {
    const json& arg = args[i];
    const M3ValueType type = m3_GetArgType(func, i);
    void* slot = &store_[i];
    pointers_[i] = slot;

    std::string reason;
    const bool ok = arg.is_object()
        ? bindBuffer(arg, type, slot, reason)
        : bindScalar(arg, type, slot, reason);

    if (!ok) {
      error = "argument " + std::to_string(i) + ": " + reason;
      return false;
    }
  }
  return true;
}

bool ArgumentBinder::bindScalar(const json& arg, M3ValueType type, void* slot,
                                std::string& error) {
  if (!arg.is_number()) {
    error = "must be a number or a buffer object";
    return false;
  }

  switch (type) {
    case c_m3Type_i32: *reinterpret_cast<int32_t*>(slot) = arg.get<int32_t>(); return true;
    case c_m3Type_i64: *reinterpret_cast<int64_t*>(slot) = arg.get<int64_t>(); return true;
    case c_m3Type_f32: *reinterpret_cast<float*>(slot) = arg.get<float>();     return true;
    case c_m3Type_f64: *reinterpret_cast<double*>(slot) = arg.get<double>();   return true;
    default:
      error = "unsupported WASM parameter type";
      return false;
  }
}

bool ArgumentBinder::bindBuffer(const json& arg, M3ValueType type, void* slot,
                                std::string& error) {
  if (type != c_m3Type_i32) {
    error = "is a buffer, but the WASM signature expects a non-pointer type";
    return false;
  }

  BufferSpec spec;
  if (!parseBufferSpec(arg, spec, error)) return false;

  const uint32_t byteSize = static_cast<uint32_t>(spec.count * spec.elemSize);
  uint32_t ptr = 0;
  if (!wasmAlloc(entry_, byteSize, ptr, error)) return false;

  allocations_.push_back(
      {ptr, byteSize, spec.count, spec.elemSize, spec.kind, spec.readBack});

  // Fetch memory *after* allocating — growth can move the base pointer.
  uint32_t memSize = 0;
  uint8_t* mem = m3_GetMemory(entry_.runtime, &memSize, 0);
  if (!mem || ptr + byteSize > memSize) {
    error = "WASM memory access out of bounds";
    return false;
  }

  if (spec.values) {
    for (size_t e = 0; e < spec.count; ++e) {
      writeElem(mem + ptr + e * spec.elemSize, spec.kind, (*spec.values)[e]);
    }
  } else {
    std::memset(mem + ptr, 0, byteSize);
  }

  *reinterpret_cast<int32_t*>(slot) = static_cast<int32_t>(ptr);
  return true;
}

bool ArgumentBinder::readOutputs(json& outputs, std::string& error) const {
  outputs = json::array();
  if (allocations_.empty()) return true;

  // Re-fetch memory: the call may have grown it.
  uint32_t memSize = 0;
  uint8_t* mem = m3_GetMemory(entry_.runtime, &memSize, 0);

  for (const auto& a : allocations_) {
    if (!a.readBack) continue;
    if (!mem || a.ptr + a.byteSize > memSize) {
      error = "WASM memory shrank during call";
      return false;
    }

    json values = json::array();
    for (size_t e = 0; e < a.count; ++e) {
      values.push_back(readElem(mem + a.ptr + e * a.elemSize, a.kind));
    }
    outputs.push_back(std::move(values));
  }
  return true;
}

// --- Return values -----------------------------------------------------------

/// Read a function's return values: null for void, the value for one, an array
/// for several.
bool readReturnValue(IM3Function func, json& out, std::string& error) {
  const uint32_t retCount = m3_GetRetCount(func);
  if (retCount == 0) {
    out = nullptr;
    return true;
  }

  std::vector<uint64_t> store(retCount, 0);
  std::vector<const void*> pointers(retCount, nullptr);
  for (uint32_t i = 0; i < retCount; ++i) pointers[i] = &store[i];

  if (M3Result r = m3_GetResults(func, retCount, pointers.data())) {
    error = std::string("failed to read return value: ") + r;
    return false;
  }

  json values = json::array();
  for (uint32_t i = 0; i < retCount; ++i) {
    const void* slot = &store[i];
    switch (m3_GetRetType(func, i)) {
      case c_m3Type_i32: values.push_back(*reinterpret_cast<const int32_t*>(slot)); break;
      case c_m3Type_i64: values.push_back(*reinterpret_cast<const int64_t*>(slot)); break;
      case c_m3Type_f32: values.push_back(*reinterpret_cast<const float*>(slot)); break;
      case c_m3Type_f64: values.push_back(*reinterpret_cast<const double*>(slot)); break;
      default: values.push_back(nullptr); break;
    }
  }

  out = retCount == 1 ? values[0] : values;
  return true;
}

/// Describe a failed m3_Call, including trap detail when wasm3 has some.
std::string describeCallFailure(IM3Runtime runtime, M3Result result) {
  M3ErrorInfo info;
  m3_GetErrorInfo(runtime, &info);

  std::string message = std::string("WASM call failed: ") + result;
  if (info.message && *info.message) {
    message += " (" + std::string(info.message) + ")";
  }
  return message;
}

} // namespace

// --- Impl --------------------------------------------------------------------

struct WasmRuntime::Impl {
  IM3Environment env = nullptr;

  mutable std::mutex modulesMutex;
  std::unordered_map<std::string, std::shared_ptr<ModuleEntry>> modules;

  mutable std::mutex statsMutex;
  std::unordered_map<std::string, double> stats;

  Impl() {
    env = m3_NewEnvironment();
    if (!env) throw std::runtime_error("Failed to create WASM environment");
  }

  ~Impl() {
    {
      std::lock_guard<std::mutex> lock(modulesMutex);
      modules.clear(); // ModuleEntry destructor frees each runtime
    }
    if (env) m3_FreeEnvironment(env);
  }

  std::shared_ptr<ModuleEntry> find(const std::string& id) const {
    std::lock_guard<std::mutex> lock(modulesMutex);
    auto it = modules.find(id);
    return it == modules.end() ? nullptr : it->second;
  }

  void recordModuleCount() {
    std::lock_guard<std::mutex> lock(statsMutex);
    stats["modules_loaded"] = static_cast<double>(modules.size());
  }
};

WasmRuntime::WasmRuntime() : pImpl(std::make_unique<Impl>()) {}
WasmRuntime::~WasmRuntime() = default;

// --- Module lifecycle --------------------------------------------------------

bool WasmRuntime::loadModule(const std::string& moduleId,
                             const std::vector<uint8_t>& wasmBytes,
                             std::string* outError) {
  auto fail = [outError](const std::string& msg) {
    if (outError) *outError = msg;
    return false;
  };

  if (wasmBytes.empty()) return fail("WASM binary is empty");

  auto entry = std::make_shared<ModuleEntry>();
  // Copy first: wasm3 retains a pointer into this buffer for the module's life.
  entry->bytes = wasmBytes;

  entry->runtime = m3_NewRuntime(pImpl->env, kStackSizeBytes, nullptr);
  if (!entry->runtime) return fail("Failed to create WASM runtime");

  IM3Module module = nullptr;
  if (M3Result r = m3_ParseModule(pImpl->env, &module, entry->bytes.data(),
                                  static_cast<uint32_t>(entry->bytes.size()))) {
    return fail(std::string("Failed to parse WASM module: ") + r);
  }

  if (M3Result r = m3_LoadModule(entry->runtime, module)) {
    // Ownership only transfers to the runtime on success, so free it here.
    m3_FreeModule(module);
    return fail(std::string("Failed to load WASM module: ") + r);
  }

  m3_RunStart(module); // optional; Rust cdylib modules usually have no start
  entry->functions = parseExportedFunctions(entry->bytes);

  {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    pImpl->modules[moduleId] = std::move(entry);
  }
  pImpl->recordModuleCount();
  return true;
}

void WasmRuntime::unloadModule(const std::string& moduleId) {
  {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    pImpl->modules.erase(moduleId);
  }
  pImpl->recordModuleCount();
}

// --- Calling -----------------------------------------------------------------

std::string WasmRuntime::call(const std::string& moduleId,
                              const std::string& functionName,
                              const std::string& argsJson) {
  auto entry = pImpl->find(moduleId);
  if (!entry) return errorResult("Module not found: " + moduleId).dump();

  // wasm3 runtimes are single-threaded; serialise per module.
  std::lock_guard<std::mutex> callLock(entry->callMutex);

  IM3Function func = nullptr;
  if (m3_FindFunction(&func, entry->runtime, functionName.c_str()) || !func) {
    return errorResult("Function not found: " + functionName).dump();
  }

  try {
    json args = json::parse(argsJson);
    if (!args.is_array()) {
      return errorResult("Arguments must be a JSON array").dump();
    }

    // Owns the WASM-side allocations until the call has been read back.
    ArgumentBinder binder(*entry);

    std::string error;
    if (!binder.bind(func, args, error)) {
      return errorResult("Cannot call '" + functionName + "': " + error).dump();
    }

    if (M3Result r = m3_Call(func, binder.count(), binder.pointers())) {
      return errorResult(describeCallFailure(entry->runtime, r)).dump();
    }

    json result;
    if (!readReturnValue(func, result, error)) {
      return errorResult(error).dump();
    }

    json outputs;
    if (!binder.readOutputs(outputs, error)) {
      return errorResult(error).dump();
    }

    json j;
    j["success"] = true;
    j["result"] = std::move(result);
    j["outputs"] = std::move(outputs);
    return j.dump();

  } catch (const json::exception& e) {
    return errorResult("JSON error: " + std::string(e.what())).dump();
  } catch (const std::exception& e) {
    return errorResult("Exception: " + std::string(e.what())).dump();
  }
}

// --- Introspection -----------------------------------------------------------

std::vector<std::string> WasmRuntime::getFunctions(const std::string& moduleId) const {
  auto entry = pImpl->find(moduleId);
  return entry ? entry->functions : std::vector<std::string>{};
}

bool WasmRuntime::isLoaded(const std::string& moduleId) const {
  return pImpl->find(moduleId) != nullptr;
}

std::unordered_map<std::string, double> WasmRuntime::getStats() const {
  std::lock_guard<std::mutex> lock(pImpl->statsMutex);
  return pImpl->stats;
}

// --- Standalone helpers ------------------------------------------------------

std::vector<uint8_t> readWasmFile(const std::string& wasmPath) {
  std::vector<uint8_t> bytes;

  FILE* file = std::fopen(wasmPath.c_str(), "rb");
  if (!file) return bytes;

  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::fseek(file, 0, SEEK_SET);

  if (size > 0) {
    bytes.resize(static_cast<size_t>(size));
    if (std::fread(bytes.data(), 1, bytes.size(), file) != bytes.size()) {
      bytes.clear();
    }
  }

  std::fclose(file);
  return bytes;
}

std::shared_ptr<NativeModule> loadSharedLibrary(const std::string& moduleId,
                                                const std::string& libraryPath) {
  try {
    return std::make_shared<SharedLibraryModule>(moduleId, libraryPath);
  } catch (const std::exception&) {
    return nullptr;
  }
}

// --- SharedBuffer ------------------------------------------------------------

SharedBuffer::SharedBuffer(size_t size) : size_(size) {
  data_ = std::make_unique<uint8_t[]>(size);
  std::memset(data_.get(), 0, size);
}

SharedBuffer::~SharedBuffer() = default;

} // namespace crossnative
