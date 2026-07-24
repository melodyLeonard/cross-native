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

/// Extract exported function names (export kind 0) from a WASM binary.
std::vector<std::string> parseExportedFunctions(const std::vector<uint8_t>& wasm) {
  std::vector<std::string> functions;
  const uint8_t* data = wasm.data();
  const size_t size = wasm.size();

  // Magic "\0asm" + version, 8 bytes total.
  if (size < 8 || std::memcmp(data, "\0asm", 4) != 0) {
    return functions;
  }

  size_t pos = 8;
  while (pos < size) {
    uint8_t sectionId = data[pos++];
    uint32_t sectionSize = 0;
    if (!readLEB128(data, size, pos, sectionSize)) break;
    size_t sectionEnd = pos + sectionSize;
    if (sectionEnd > size) break;

    if (sectionId != 7) { // not the export section
      pos = sectionEnd;
      continue;
    }

    uint32_t count = 0;
    if (!readLEB128(data, size, pos, count)) break;

    for (uint32_t i = 0; i < count && pos < sectionEnd; ++i) {
      uint32_t nameLen = 0;
      if (!readLEB128(data, size, pos, nameLen)) break;
      if (pos + nameLen > sectionEnd) break;

      std::string name(reinterpret_cast<const char*>(data + pos), nameLen);
      pos += nameLen;

      if (pos >= sectionEnd) break;
      uint8_t kind = data[pos++];

      uint32_t index = 0;
      if (!readLEB128(data, size, pos, index)) break;

      if (kind == 0) { // function export
        functions.push_back(std::move(name));
      }
    }
    break; // there is only ever one export section
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
    case ElemKind::F64: { double v = value.get<double>();   std::memcpy(dst, &v, 8); break; }
    case ElemKind::F32: { float v = value.get<float>();     std::memcpy(dst, &v, 4); break; }
    case ElemKind::I32: { int32_t v = value.get<int32_t>(); std::memcpy(dst, &v, 4); break; }
    case ElemKind::U32: { uint32_t v = value.get<uint32_t>(); std::memcpy(dst, &v, 4); break; }
    case ElemKind::I64: { int64_t v = value.get<int64_t>(); std::memcpy(dst, &v, 8); break; }
    case ElemKind::U64: { uint64_t v = value.get<uint64_t>(); std::memcpy(dst, &v, 8); break; }
    case ElemKind::I8:  { int8_t v = value.get<int8_t>();   std::memcpy(dst, &v, 1); break; }
    case ElemKind::U8:  { uint8_t v = value.get<uint8_t>(); std::memcpy(dst, &v, 1); break; }
    case ElemKind::I16: { int16_t v = value.get<int16_t>(); std::memcpy(dst, &v, 2); break; }
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

json errorResult(const std::string& message) {
  json j;
  j["success"] = false;
  j["error"] = message;
  return j;
}

} // namespace

// --- Impl --------------------------------------------------------------------

struct WasmRuntime::Impl {
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

  IM3Environment env = nullptr;

  mutable std::mutex modulesMutex;
  std::unordered_map<std::string, std::shared_ptr<ModuleEntry>> modules;

  mutable std::mutex statsMutex;
  std::unordered_map<std::string, double> stats;

  Impl() {
    env = m3_NewEnvironment();
    if (!env) {
      throw std::runtime_error("Failed to create WASM environment");
    }
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

  /// Call the module's exported allocator. Caller must hold entry->callMutex.
  bool wasmAlloc(ModuleEntry& entry, uint32_t size, uint32_t& outPtr,
                 std::string& error) {
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
    void* rets[1] = {&ptr};
    if (M3Result r = m3_GetResults(allocFn, 1, const_cast<const void**>(rets))) {
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

  if (wasmBytes.empty()) {
    return fail("WASM binary is empty");
  }

  auto entry = std::make_shared<Impl::ModuleEntry>();
  // Copy first: wasm3 retains a pointer into this buffer for the module's life.
  entry->bytes = wasmBytes;

  entry->runtime = m3_NewRuntime(pImpl->env, kStackSizeBytes, nullptr);
  if (!entry->runtime) {
    return fail("Failed to create WASM runtime");
  }

  IM3Module module = nullptr;
  if (M3Result r = m3_ParseModule(pImpl->env, &module,
                                  entry->bytes.data(),
                                  static_cast<uint32_t>(entry->bytes.size()))) {
    return fail(std::string("Failed to parse WASM module: ") + r);
  }

  if (M3Result r = m3_LoadModule(entry->runtime, module)) {
    // Ownership only transfers to the runtime on success, so free it here.
    m3_FreeModule(module);
    return fail(std::string("Failed to load WASM module: ") + r);
  }

  // Optional start function (Rust cdylib modules usually have none).
  m3_RunStart(module);

  entry->functions = parseExportedFunctions(entry->bytes);

  {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    pImpl->modules[moduleId] = std::move(entry);
    std::lock_guard<std::mutex> statsLock(pImpl->statsMutex);
    pImpl->stats["modules_loaded"] = static_cast<double>(pImpl->modules.size());
  }

  return true;
}

void WasmRuntime::unloadModule(const std::string& moduleId) {
  std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
  pImpl->modules.erase(moduleId);
  std::lock_guard<std::mutex> statsLock(pImpl->statsMutex);
  pImpl->stats["modules_loaded"] = static_cast<double>(pImpl->modules.size());
}

// --- Calling -----------------------------------------------------------------

std::string WasmRuntime::call(const std::string& moduleId,
                              const std::string& functionName,
                              const std::string& argsJson) {
  auto entry = pImpl->find(moduleId);
  if (!entry) {
    return errorResult("Module not found: " + moduleId).dump();
  }

  // wasm3 runtimes are single-threaded; serialise per module.
  std::lock_guard<std::mutex> callLock(entry->callMutex);

  IM3Function func = nullptr;
  if (m3_FindFunction(&func, entry->runtime, functionName.c_str()) || !func) {
    return errorResult("Function not found: " + functionName).dump();
  }

  /// A buffer allocated inside WASM memory for the duration of this call.
  struct Allocation {
    uint32_t ptr = 0;
    uint32_t byteSize = 0;
    size_t count = 0;
    ElemKind kind = ElemKind::F64;
    bool readBack = false;
  };
  std::vector<Allocation> allocations;

  // Free every allocation before returning, whatever the outcome.
  struct Guard {
    Impl* impl;
    Impl::ModuleEntry* entry;
    std::vector<Allocation>* allocs;
    ~Guard() {
      for (const auto& a : *allocs) impl->wasmFree(*entry, a.ptr, a.byteSize);
    }
  } guard{pImpl.get(), entry.get(), &allocations};

  try {
    json args = json::parse(argsJson);
    if (!args.is_array()) {
      return errorResult("Arguments must be a JSON array").dump();
    }

    const uint32_t argCount = m3_GetArgCount(func);
    if (args.size() != argCount) {
      return errorResult("Argument count mismatch for '" + functionName +
                         "': WASM expects " + std::to_string(argCount) +
                         ", got " + std::to_string(args.size()))
          .dump();
    }

    // Pre-sized so the storage never reallocates while we hold pointers into it.
    std::vector<uint64_t> argStore(argCount ? argCount : 1, 0);
    std::vector<const void*> argPtrs(argCount ? argCount : 1, nullptr);

    for (uint32_t i = 0; i < argCount; ++i) {
      const json& arg = args[i];
      M3ValueType type = m3_GetArgType(func, i);
      void* slot = &argStore[i];
      argPtrs[i] = slot;

      // Buffer argument: allocate inside WASM memory and pass the offset.
      if (arg.is_object()) {
        const bool isIn = arg.contains("in");
        const bool isOut = arg.contains("out");
        const bool isInOut = arg.contains("inout");
        if (!isIn && !isOut && !isInOut) {
          return errorResult("Argument " + std::to_string(i) +
                             " must contain 'in', 'out' or 'inout'")
              .dump();
        }
        if (type != c_m3Type_i32) {
          return errorResult("Argument " + std::to_string(i) +
                             " is a buffer, but the WASM signature expects a "
                             "non-pointer type")
              .dump();
        }

        std::string typeName = arg.value("type", "f64");
        ElemKind kind;
        size_t elemSize = 0;
        if (!parseElemKind(typeName, kind, elemSize)) {
          return errorResult("Unsupported buffer element type: " + typeName).dump();
        }

        const json* values = nullptr;
        size_t count = 0;
        if (isOut) {
          if (!arg["out"].is_number_unsigned()) {
            return errorResult("'out' must be an element count").dump();
          }
          count = arg["out"].get<size_t>();
        } else {
          values = isIn ? &arg["in"] : &arg["inout"];
          if (!values->is_array()) {
            return errorResult("'in'/'inout' must be an array").dump();
          }
          count = values->size();
        }

        const uint32_t byteSize = static_cast<uint32_t>(count * elemSize);
        if (byteSize == 0) {
          return errorResult("Buffer argument " + std::to_string(i) + " is empty")
              .dump();
        }

        uint32_t ptr = 0;
        std::string allocError;
        if (!pImpl->wasmAlloc(*entry, byteSize, ptr, allocError)) {
          return errorResult(allocError).dump();
        }
        allocations.push_back({ptr, byteSize, count, kind, isOut || isInOut});

        // Fetch memory *after* allocating — growth can move the base pointer.
        uint32_t memSize = 0;
        uint8_t* mem = m3_GetMemory(entry->runtime, &memSize, 0);
        if (!mem || ptr + byteSize > memSize) {
          return errorResult("WASM memory access out of bounds").dump();
        }

        if (values) {
          uint8_t* dst = mem + ptr;
          for (size_t e = 0; e < count; ++e) {
            writeElem(dst + e * elemSize, kind, (*values)[e]);
          }
        } else {
          std::memset(mem + ptr, 0, byteSize);
        }

        *reinterpret_cast<int32_t*>(slot) = static_cast<int32_t>(ptr);
        continue;
      }

      // Scalar argument: coerce to whatever the WASM signature declares.
      if (!arg.is_number()) {
        return errorResult("Argument " + std::to_string(i) +
                           " must be a number or a buffer object")
            .dump();
      }

      switch (type) {
        case c_m3Type_i32:
          *reinterpret_cast<int32_t*>(slot) = arg.get<int32_t>();
          break;
        case c_m3Type_i64:
          *reinterpret_cast<int64_t*>(slot) = arg.get<int64_t>();
          break;
        case c_m3Type_f32:
          *reinterpret_cast<float*>(slot) = arg.get<float>();
          break;
        case c_m3Type_f64:
          *reinterpret_cast<double*>(slot) = arg.get<double>();
          break;
        default:
          return errorResult("Unsupported WASM argument type at index " +
                             std::to_string(i))
              .dump();
      }
    }

    if (M3Result r = m3_Call(func, argCount, argPtrs.data())) {
      // A trap carries extra detail (out-of-bounds access, unreachable, ...).
      M3ErrorInfo info;
      m3_GetErrorInfo(entry->runtime, &info);
      std::string message = std::string("WASM call failed: ") + r;
      if (info.message && *info.message) {
        message += " (" + std::string(info.message) + ")";
      }
      return errorResult(message).dump();
    }

    // Read return values.
    json resultValue = nullptr;
    const uint32_t retCount = m3_GetRetCount(func);
    if (retCount > 0) {
      std::vector<uint64_t> retStore(retCount, 0);
      std::vector<const void*> retPtrs(retCount, nullptr);
      for (uint32_t i = 0; i < retCount; ++i) retPtrs[i] = &retStore[i];

      if (M3Result r = m3_GetResults(func, retCount, retPtrs.data())) {
        return errorResult(std::string("Failed to read return value: ") + r).dump();
      }

      json values = json::array();
      for (uint32_t i = 0; i < retCount; ++i) {
        const void* slot = &retStore[i];
        switch (m3_GetRetType(func, i)) {
          case c_m3Type_i32: values.push_back(*reinterpret_cast<const int32_t*>(slot)); break;
          case c_m3Type_i64: values.push_back(*reinterpret_cast<const int64_t*>(slot)); break;
          case c_m3Type_f32: values.push_back(*reinterpret_cast<const float*>(slot)); break;
          case c_m3Type_f64: values.push_back(*reinterpret_cast<const double*>(slot)); break;
          default: values.push_back(nullptr); break;
        }
      }
      resultValue = retCount == 1 ? values[0] : values;
    }

    // Read back output buffers. Re-fetch memory: the call may have grown it.
    json outputs = json::array();
    if (!allocations.empty()) {
      uint32_t memSize = 0;
      uint8_t* mem = m3_GetMemory(entry->runtime, &memSize, 0);
      for (const auto& a : allocations) {
        if (!a.readBack) continue;
        if (!mem || a.ptr + a.byteSize > memSize) {
          return errorResult("WASM memory shrank during call").dump();
        }
        const size_t elemSize = a.byteSize / (a.count ? a.count : 1);
        json values = json::array();
        for (size_t e = 0; e < a.count; ++e) {
          values.push_back(readElem(mem + a.ptr + e * elemSize, a.kind));
        }
        outputs.push_back(std::move(values));
      }
    }

    json j;
    j["success"] = true;
    j["result"] = resultValue;
    j["outputs"] = outputs;
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
  long size = std::ftell(file);
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
