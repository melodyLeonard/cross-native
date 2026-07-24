/**
 * WasmRuntime.cpp — WAMR backend
 *
 * Drop-in replacement for the wasm3 backend.  The public surface
 * (loadModule / unloadModule / call / getFunctions / getManifest) is
 * identical to the original implementation; only the engine underneath
 * changes.
 *
 * Key design decisions
 * ────────────────────
 * • wasm_runtime_init() is called once, globally, protected by a flag so
 *   multiple WasmRuntime instances don't conflict.
 * • Each module gets its own wasm_module_t + wasm_module_inst_t.
 *   WAMR modules are not thread-safe for calls, so every entry also owns a
 *   per-module mutex (same model as the wasm3 code we replaced).
 * • Arguments and return values are marshalled through the wasm_val_t /
 *   wasm_runtime_call_wasm_a() API so we never have to hand-pack uint32
 *   argv[] cells.
 * • Buffer arguments (in/out/inout) are allocated in the module's heap via
 *   wasm_runtime_module_malloc() / module_free(), and the WASM pointer is
 *   passed as an i32 parameter — exactly what the original code did with
 *   cn_alloc / cn_free shims.
 * • Export enumeration uses wasm_runtime_get_export_count() /
 *   wasm_runtime_get_export_type(), so we no longer need the hand-rolled
 *   LEB128 parser.
 * • The signature / manifest system (__cn_meta_* exports) is preserved
 *   in full; only the call path to invoke those functions changes.
 */

#include "WasmRuntime.hpp"
#include "NativeModule.hpp"
#include "wasm_export.h"
#include "json.hpp"

#include <cstring>
#include <cmath>
#include <fstream>
#include <mutex>
#include <atomic>
#include <cassert>

namespace crossnative {

using json = nlohmann::json;

// ─── Forward declarations ──────────────────────────────────────────────────

namespace {

// ─── Global runtime init ──────────────────────────────────────────────────

static std::mutex    g_runtimeInitMutex;
static std::atomic<bool> g_runtimeInitialised{false};

void ensureRuntimeInit() {
    if (g_runtimeInitialised.load(std::memory_order_acquire)) return;
    std::lock_guard<std::mutex> lock(g_runtimeInitMutex);
    if (g_runtimeInitialised.load(std::memory_order_relaxed)) return;

    RuntimeInitArgs init_args;
    std::memset(&init_args, 0, sizeof(init_args));
    init_args.mem_alloc_type = Alloc_With_System_Allocator;
    // Request the Fast Interpreter for maximum portable performance.
    init_args.running_mode = Mode_Interp;

    bool ok = wasm_runtime_full_init(&init_args);
    (void)ok;
    assert(ok && "wasm_runtime_full_init failed");

    // Suppress verbose internal logging; keep warnings and above.
    wasm_runtime_set_log_level(WASM_LOG_LEVEL_WARNING);

    g_runtimeInitialised.store(true, std::memory_order_release);
}

// ─── Per-thread environment ───────────────────────────────────────────────
// With hardware bounds checking enabled, WAMR installs a per-thread signal
// handler and expects every OS thread that executes WASM to have called
// wasm_runtime_init_thread_env(). Our thread pool runs calls on arbitrary
// workers, so each one initialises its environment on first use and tears it
// down when the thread exits.

void ensureThreadEnv() {
    struct ThreadEnvGuard {
        bool owned = false;
        ~ThreadEnvGuard() { if (owned) wasm_runtime_destroy_thread_env(); }
    };
    static thread_local ThreadEnvGuard guard;

    if (!guard.owned && !wasm_runtime_thread_env_inited()) {
        wasm_runtime_init_thread_env();
        guard.owned = true; // this thread owns the env; destroy it on exit
    }
}

// ─── Element type helpers (unchanged from wasm3 backend) ──────────────────

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
        case ElemKind::F64: { double   v = value.get<double>();   std::memcpy(dst, &v, 8); break; }
        case ElemKind::F32: { float    v = value.get<float>();    std::memcpy(dst, &v, 4); break; }
        case ElemKind::I32: { int32_t  v = value.get<int32_t>();  std::memcpy(dst, &v, 4); break; }
        case ElemKind::U32: { uint32_t v = value.get<uint32_t>(); std::memcpy(dst, &v, 4); break; }
        case ElemKind::I64: { int64_t  v = value.get<int64_t>();  std::memcpy(dst, &v, 8); break; }
        case ElemKind::U64: { uint64_t v = value.get<uint64_t>(); std::memcpy(dst, &v, 8); break; }
        case ElemKind::I8:  { int8_t   v = value.get<int8_t>();   std::memcpy(dst, &v, 1); break; }
        case ElemKind::U8:  { uint8_t  v = value.get<uint8_t>();  std::memcpy(dst, &v, 1); break; }
        case ElemKind::I16: { int16_t  v = value.get<int16_t>();  std::memcpy(dst, &v, 2); break; }
        case ElemKind::U16: { uint16_t v = value.get<uint16_t>(); std::memcpy(dst, &v, 2); break; }
    }
}

json readElem(const uint8_t* src, ElemKind kind) {
    switch (kind) {
        case ElemKind::F64: { double   v; std::memcpy(&v, src, 8); return v; }
        case ElemKind::F32: { float    v; std::memcpy(&v, src, 4); return v; }
        case ElemKind::I32: { int32_t  v; std::memcpy(&v, src, 4); return v; }
        case ElemKind::U32: { uint32_t v; std::memcpy(&v, src, 4); return v; }
        case ElemKind::I64: { int64_t  v; std::memcpy(&v, src, 8); return v; }
        case ElemKind::U64: { uint64_t v; std::memcpy(&v, src, 8); return v; }
        case ElemKind::I8:  { int8_t   v; std::memcpy(&v, src, 1); return v; }
        case ElemKind::U8:  { uint8_t  v; std::memcpy(&v, src, 1); return v; }
        case ElemKind::I16: { int16_t  v; std::memcpy(&v, src, 2); return v; }
        case ElemKind::U16: { uint16_t v; std::memcpy(&v, src, 2); return v; }
    }
    return nullptr;
}

// ─── Signature system (unchanged from wasm3 backend) ──────────────────────

struct ValueType {
    enum class Shape { Void, Scalar, Vector, Text };
    Shape  shape    = Shape::Void;
    ElemKind elem   = ElemKind::F64;
    size_t elemSize = 0;
};

bool parseValueType(const std::string& text, ValueType& out) {
    if (text == "void")   { out.shape = ValueType::Shape::Void;   return true; }
    if (text == "string") { out.shape = ValueType::Shape::Text;   return true; }
    constexpr const char* kVecPrefix = "vec<";
    if (text.rfind(kVecPrefix, 0) == 0 && text.back() == '>') {
        const std::string elem = text.substr(4, text.size() - 5);
        if (!parseElemKind(elem, out.elem, out.elemSize)) return false;
        out.shape = ValueType::Shape::Vector;
        return true;
    }
    ElemKind kind; size_t size = 0;
    if (!parseElemKind(text, kind, size)) return false;
    out.shape    = ValueType::Shape::Scalar;
    out.elem     = kind;
    out.elemSize = size;
    return true;
}

struct Signature {
    std::vector<std::string> paramNames;
    std::vector<ValueType>   params;
    ValueType                returns;
};

bool parseSignature(const json& doc, Signature& out) {
    if (!doc.contains("params") || !doc["params"].is_array()) return false;
    for (const auto& param : doc["params"]) {
        ValueType type;
        if (!parseValueType(param.value("type", ""), type)) return false;
        out.paramNames.push_back(param.value("name", ""));
        out.params.push_back(type);
    }
    return parseValueType(doc.value("returns", "void"), out.returns);
}

void unpackHandle(uint64_t handle, uint32_t& ptr, uint32_t& count) {
    ptr   = static_cast<uint32_t>(handle >> 32);
    count = static_cast<uint32_t>(handle & 0xFFFFFFFFu);
}

// ─── Buffer protocol helpers ───────────────────────────────────────────────

struct BufferSpec {
    ElemKind    kind     = ElemKind::F64;
    size_t      elemSize = 0;
    size_t      count    = 0;
    const json* values   = nullptr;   // non-null for in / inout
    bool        readBack = false;
};

bool parseBufferSpec(const json& arg, BufferSpec& spec, std::string& error) {
    const bool isIn    = arg.contains("in");
    const bool isOut   = arg.contains("out");
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
        if (!arg["out"].is_number_unsigned()) { error = "'out' must be an element count"; return false; }
        spec.count = arg["out"].get<size_t>();
    } else {
        spec.values = isIn ? &arg["in"] : &arg["inout"];
        if (!spec.values->is_array()) { error = "'in'/'inout' must be an array"; return false; }
        spec.count = spec.values->size();
    }
    spec.readBack = isOut || isInOut;
    if (spec.count == 0) { error = "buffer argument is empty"; return false; }
    return true;
}

// ─── WAMR type helpers ────────────────────────────────────────────────────

/// Convert a wasm_valkind_t to the matching JSON value from a wasm_val_t.
json valToJson(const wasm_val_t& v) {
    switch (v.kind) {
        case WASM_I32: return v.of.i32;
        case WASM_I64: return v.of.i64;
        case WASM_F32: return static_cast<double>(v.of.f32);
        case WASM_F64: return v.of.f64;
        default:       return nullptr;
    }
}

/// Fill a wasm_val_t from a JSON number and a known valkind.
bool jsonToVal(const json& j, wasm_valkind_t kind, wasm_val_t& out, std::string& error) {
    if (!j.is_number()) { error = "must be a number"; return false; }
    out.kind = kind;
    switch (kind) {
        case WASM_I32: out.of.i32 = j.get<int32_t>();  return true;
        case WASM_I64: out.of.i64 = j.get<int64_t>();  return true;
        case WASM_F32: out.of.f32 = j.get<float>();    return true;
        case WASM_F64: out.of.f64 = j.get<double>();   return true;
        default: error = "unsupported WASM parameter type"; return false;
    }
}

// ─── Loaded module entry ──────────────────────────────────────────────────

constexpr uint32_t kStackSize      = 512 * 1024;
constexpr uint32_t kHeapSize       = 512 * 1024;
constexpr const char* kAllocFn     = "cn_alloc";
constexpr const char* kFreeFn      = "cn_free";
constexpr const char* kMetaPrefix  = "__cn_meta_";

struct ModuleEntry {
    // WAMR requires the byte buffer to remain alive while the module is loaded.
    std::vector<uint8_t>  bytes;
    wasm_module_t         module    = nullptr;
    wasm_module_inst_t    instance  = nullptr;
    wasm_exec_env_t       execEnv   = nullptr;

    std::vector<std::string>                      functions;
    std::unordered_map<std::string, Signature>    signatures;
    std::string                                   manifestJson = "[]";

    // Serialise all calls into this module.
    std::mutex callMutex;

    ~ModuleEntry() {
        if (execEnv) wasm_runtime_destroy_exec_env(execEnv);
        if (instance) wasm_runtime_deinstantiate(instance);
        if (module)  wasm_runtime_unload(module);
    }
};

// ─── Module memory helpers ────────────────────────────────────────────────

/// Allocate bytes in the WASM module heap via cn_alloc.
/// Returns the app (linear-memory) offset, or 0 on failure.
uint64_t wasmAlloc(ModuleEntry& entry, uint32_t byteSize, std::string& error) {
    wasm_function_inst_t allocFn =
        wasm_runtime_lookup_function(entry.instance, kAllocFn);
    if (!allocFn) {
        error = std::string("Module does not export '") + kAllocFn +
                "', which is required to pass array arguments";
        return 0;
    }

    wasm_val_t arg{};  arg.kind = WASM_I32; arg.of.i32 = static_cast<int32_t>(byteSize);
    wasm_val_t ret{};  ret.kind = WASM_I32;
    if (!wasm_runtime_call_wasm_a(entry.execEnv, allocFn, 1, &ret, 1, &arg)) {
        error = std::string("cn_alloc failed: ") +
                (wasm_runtime_get_exception(entry.instance) ?: "unknown");
        wasm_runtime_clear_exception(entry.instance);
        return 0;
    }
    if (ret.of.i32 == 0) { error = "cn_alloc returned null (out of WASM memory?)"; return 0; }
    return static_cast<uint64_t>(static_cast<uint32_t>(ret.of.i32));
}

/// Release bytes via cn_free (best-effort).
void wasmFree(ModuleEntry& entry, uint64_t appPtr, uint32_t byteSize) {
    wasm_function_inst_t freeFn =
        wasm_runtime_lookup_function(entry.instance, kFreeFn);
    if (!freeFn) return;
    wasm_val_t args[2]{};
    args[0].kind = WASM_I32; args[0].of.i32 = static_cast<int32_t>(appPtr);
    args[1].kind = WASM_I32; args[1].of.i32 = static_cast<int32_t>(byteSize);
    wasm_runtime_call_wasm_a(entry.execEnv, freeFn, 0, nullptr, 2, args);
    wasm_runtime_clear_exception(entry.instance);
}

/// Get native pointer to WASM linear memory at app offset.
uint8_t* nativePtr(ModuleEntry& entry, uint64_t appOffset) {
    return reinterpret_cast<uint8_t*>(
        wasm_runtime_addr_app_to_native(entry.instance, appOffset));
}

// ─── Manifest (metadata) reader ───────────────────────────────────────────

/// Call a __cn_meta_* function and copy out the bytes it returns.
/// These functions return a packed i64: high 32 bits = ptr, low 32 bits = len.
bool readMetadata(ModuleEntry& entry, const std::string& metaName, std::string& out) {
    wasm_function_inst_t func =
        wasm_runtime_lookup_function(entry.instance, metaName.c_str());
    if (!func) return false;

    wasm_val_t ret{}; ret.kind = WASM_I64;
    if (!wasm_runtime_call_wasm_a(entry.execEnv, func, 1, &ret, 0, nullptr)) {
        wasm_runtime_clear_exception(entry.instance);
        return false;
    }

    uint32_t ptr = 0, length = 0;
    unpackHandle(static_cast<uint64_t>(ret.of.i64), ptr, length);
    if (ptr == 0 || length == 0) { out.clear(); return true; }

    uint8_t* mem = nativePtr(entry, ptr);
    if (!mem) return false;
    out.assign(reinterpret_cast<const char*>(mem), length);
    wasmFree(entry, ptr, length);
    return true;
}

void readManifest(ModuleEntry& entry) {
    json manifest = json::array();
    for (const auto& exported : entry.functions) {
        if (exported.rfind(kMetaPrefix, 0) != 0) continue;
        std::string document;
        if (!readMetadata(entry, exported, document) || document.empty()) continue;
        try {
            auto doc = json::parse(document);
            Signature sig;
            if (!parseSignature(doc, sig)) continue;
            entry.signatures[doc.value("name", "")] = std::move(sig);
            manifest.push_back(std::move(doc));
        } catch (const json::exception&) {}
    }
    entry.manifestJson = manifest.dump();
}

// ─── Argument binder ──────────────────────────────────────────────────────

/// Allocation made inside WASM linear memory for the duration of one call.
struct Allocation {
    uint64_t appPtr  = 0;
    uint32_t byteSize = 0;
    size_t   count    = 0;
    size_t   elemSize = 0;
    ElemKind kind     = ElemKind::F64;
    bool     readBack = false;
};

/**
 * Collects all argument conversions for one call.
 *
 * Raw-buffer calls (no __cn_meta_) use bind().
 * Typed calls (modules built with #[crossnative]) use bindTyped().
 *
 * On destruction, every WASM-heap allocation is freed automatically.
 */
class ArgumentBinder {
public:
    explicit ArgumentBinder(ModuleEntry& entry) : entry_(entry) {}

    ~ArgumentBinder() {
        for (const auto& a : allocations_) wasmFree(entry_, a.appPtr, a.byteSize);
    }

    ArgumentBinder(const ArgumentBinder&) = delete;
    ArgumentBinder& operator=(const ArgumentBinder&) = delete;

    /// Raw (untyped) binding: arg is a JSON number or {in/out/inout}.
    bool bind(wasm_function_inst_t func, const json& args, std::string& error);

    /// Typed binding using a declared signature from __cn_meta_*.
    bool bindTyped(wasm_function_inst_t func, const json& args,
                   const Signature& sig, std::string& error);

    /// Copy output buffers back into a JSON array.
    bool readOutputs(json& outputs, std::string& error) const;

    const std::vector<wasm_val_t>& vals() const { return vals_; }

private:
    bool bindScalar(const json& arg, wasm_valkind_t kind,
                    wasm_val_t& out, std::string& error);
    bool bindBuffer(const json& arg, wasm_val_t& out, std::string& error);
    bool bindBytes(const uint8_t* data, size_t byteSize, size_t count,
                   wasm_val_t& ptrSlot, wasm_val_t& lenSlot, std::string& error);

    ModuleEntry&            entry_;
    std::vector<wasm_val_t> vals_;
    std::vector<Allocation> allocations_;
};

bool ArgumentBinder::bindScalar(const json& arg, wasm_valkind_t kind,
                                 wasm_val_t& out, std::string& error) {
    return jsonToVal(arg, kind, out, error);
}

bool ArgumentBinder::bindBuffer(const json& arg, wasm_val_t& out, std::string& error) {
    BufferSpec spec;
    if (!parseBufferSpec(arg, spec, error)) return false;

    const uint32_t byteSize = static_cast<uint32_t>(spec.count * spec.elemSize);
    uint64_t appPtr = wasmAlloc(entry_, byteSize, error);
    if (!appPtr) return false;

    allocations_.push_back({appPtr, byteSize, spec.count, spec.elemSize, spec.kind, spec.readBack});

    uint8_t* mem = nativePtr(entry_, appPtr);
    if (!mem) { error = "WASM memory access out of bounds"; return false; }

    if (spec.values) {
        for (size_t e = 0; e < spec.count; ++e)
            writeElem(mem + e * spec.elemSize, spec.kind, (*spec.values)[e]);
    } else {
        std::memset(mem, 0, byteSize);
    }

    out.kind = WASM_I32;
    out.of.i32 = static_cast<int32_t>(appPtr);
    return true;
}

bool ArgumentBinder::bindBytes(const uint8_t* data, size_t byteSize, size_t count,
                                wasm_val_t& ptrSlot, wasm_val_t& lenSlot,
                                std::string& error) {
    uint64_t appPtr = wasmAlloc(entry_, static_cast<uint32_t>(byteSize), error);
    if (!appPtr) return false;

    allocations_.push_back({appPtr, static_cast<uint32_t>(byteSize), count, 1, ElemKind::U8, false});

    uint8_t* mem = nativePtr(entry_, appPtr);
    if (!mem) { error = "WASM memory access out of bounds"; return false; }
    std::memcpy(mem, data, byteSize);

    ptrSlot.kind = WASM_I32; ptrSlot.of.i32 = static_cast<int32_t>(appPtr);
    lenSlot.kind = WASM_I32; lenSlot.of.i32 = static_cast<int32_t>(count);
    return true;
}

bool ArgumentBinder::bind(wasm_function_inst_t func,
                           const json& args, std::string& error) {
    const uint32_t argCount = wasm_func_get_param_count(func, entry_.instance);
    if (args.size() != argCount) {
        error = "argument count mismatch: WASM expects " + std::to_string(argCount) +
                ", got " + std::to_string(args.size());
        return false;
    }

    std::vector<wasm_valkind_t> kinds(argCount);
    wasm_func_get_param_types(func, entry_.instance, kinds.data());
    vals_.resize(argCount);

    for (uint32_t i = 0; i < argCount; ++i) {
        const json& arg = args[i];
        std::string reason;
        bool ok = arg.is_object()
            ? bindBuffer(arg, vals_[i], reason)
            : bindScalar(arg, kinds[i], vals_[i], reason);
        if (!ok) { error = "argument " + std::to_string(i) + ": " + reason; return false; }
    }
    return true;
}

bool ArgumentBinder::bindTyped(wasm_function_inst_t func,
                                const json& args, const Signature& sig,
                                std::string& error) {
    if (args.size() != sig.params.size()) {
        error = "expects " + std::to_string(sig.params.size()) +
                " argument(s), got " + std::to_string(args.size());
        return false;
    }

    const uint32_t slotCount = wasm_func_get_param_count(func, entry_.instance);
    std::vector<wasm_valkind_t> kinds(slotCount);
    wasm_func_get_param_types(func, entry_.instance, kinds.data());
    vals_.resize(slotCount ? slotCount : 1);
    // Zero-initialise all slots upfront.
    for (auto& v : vals_) { v.kind = WASM_I32; v.of.i32 = 0; }

    uint32_t slot = 0;
    for (size_t i = 0; i < sig.params.size(); ++i) {
        const ValueType& type = sig.params[i];
        const json&      arg  = args[i];
        const std::string where = "argument " + std::to_string(i) +
                                  " ('" + sig.paramNames[i] + "')";
        if (slot >= slotCount) {
            error = where + ": more arguments than the module expects";
            return false;
        }

        std::string reason;
        bool ok = false;

        switch (type.shape) {
            case ValueType::Shape::Scalar:
                ok = bindScalar(arg, kinds[slot], vals_[slot], reason);
                slot += 1;
                break;

            case ValueType::Shape::Vector: {
                if (!arg.is_array()) { error = where + ": expected an array"; return false; }
                if (slot + 1 >= slotCount) { error = where + ": missing length slot"; return false; }
                std::vector<uint8_t> bytes(arg.size() * type.elemSize);
                for (size_t e = 0; e < arg.size(); ++e)
                    writeElem(bytes.data() + e * type.elemSize, type.elem, arg[e]);
                ok = bindBytes(bytes.data(), bytes.size(), arg.size(),
                               vals_[slot], vals_[slot + 1], reason);
                slot += 2;
                break;
            }

            case ValueType::Shape::Text: {
                if (!arg.is_string()) { error = where + ": expected a string"; return false; }
                if (slot + 1 >= slotCount) { error = where + ": missing length slot"; return false; }
                const std::string text = arg.get<std::string>();
                ok = bindBytes(reinterpret_cast<const uint8_t*>(text.data()),
                               text.size(), text.size(),
                               vals_[slot], vals_[slot + 1], reason);
                slot += 2;
                break;
            }

            case ValueType::Shape::Void:
                error = where + ": void is not a valid parameter type";
                return false;
        }

        if (!ok) { error = where + ": " + reason; return false; }
    }
    return true;
}

bool ArgumentBinder::readOutputs(json& outputs, std::string& error) const {
    outputs = json::array();
    for (const auto& a : allocations_) {
        if (!a.readBack) continue;
        uint8_t* mem = nativePtr(const_cast<ModuleEntry&>(entry_), a.appPtr);
        if (!mem) { error = "WASM memory shrank during call"; return false; }

        json values = json::array();
        for (size_t e = 0; e < a.count; ++e)
            values.push_back(readElem(mem + e * a.elemSize, a.kind));
        outputs.push_back(std::move(values));
    }
    return true;
}

// ─── Return-value readers ─────────────────────────────────────────────────

json readReturnValues(wasm_function_inst_t func,
                      wasm_module_inst_t instance,
                      const std::vector<wasm_val_t>& rets) {
    const uint32_t retCount = wasm_func_get_result_count(func, instance);
    if (retCount == 0) return nullptr;
    if (retCount == 1) return valToJson(rets[0]);

    json arr = json::array();
    for (uint32_t i = 0; i < retCount; ++i) arr.push_back(valToJson(rets[i]));
    return arr;
}

json readTypedReturn(ModuleEntry& entry, wasm_function_inst_t func,
                     const ValueType& returns,
                     const std::vector<wasm_val_t>& rets,
                     std::string& error) {
    if (returns.shape == ValueType::Shape::Void) return nullptr;
    if (returns.shape == ValueType::Shape::Scalar)
        return readReturnValues(func, entry.instance, rets);

    // Vector or Text: the shim returns a packed i64 (ptr, count).
    if (rets.empty()) { error = "expected i64 return for vector/text"; return nullptr; }
    uint32_t ptr = 0, count = 0;
    unpackHandle(static_cast<uint64_t>(rets[0].of.i64), ptr, count);

    if (returns.shape == ValueType::Shape::Text) {
        if (!ptr || !count) return std::string{};
        uint8_t* mem = nativePtr(entry, ptr);
        if (!mem) { error = "returned string is out of bounds"; return nullptr; }
        std::string text(reinterpret_cast<const char*>(mem), count);
        wasmFree(entry, ptr, count);
        return text;
    }

    // Vector
    if (!ptr || !count) return json::array();
    uint8_t* mem = nativePtr(entry, ptr);
    if (!mem) { error = "returned array is out of bounds"; return nullptr; }
    json values = json::array();
    for (uint32_t i = 0; i < count; ++i)
        values.push_back(readElem(mem + i * returns.elemSize, returns.elem));
    wasmFree(entry, ptr, static_cast<uint32_t>(count * returns.elemSize));
    return values;
}

// ─── Error helpers ────────────────────────────────────────────────────────

json errorResult(const std::string& message) {
    return {{"success", false}, {"error", message}};
}

} // anonymous namespace

// ─── WasmRuntime::Impl ────────────────────────────────────────────────────

struct WasmRuntime::Impl {
    mutable std::mutex modulesMutex;
    std::unordered_map<std::string, std::shared_ptr<ModuleEntry>> modules;

    mutable std::mutex statsMutex;
    double totalCallMs  = 0.0;
    uint64_t totalCalls = 0;
};

// ─── WasmRuntime public API ───────────────────────────────────────────────

WasmRuntime::WasmRuntime() : pImpl(std::make_unique<Impl>()) {
    ensureRuntimeInit();
    ensureThreadEnv();
}

WasmRuntime::~WasmRuntime() = default;

bool WasmRuntime::loadModule(const std::string& moduleId,
                              const std::vector<uint8_t>& wasmBytes,
                              std::string* outError) {
    ensureThreadEnv();

    auto entry = std::make_shared<ModuleEntry>();
    // Keep a writable copy — WAMR may patch it internally.
    entry->bytes = wasmBytes;

    char error_buf[256];

    // Load
    entry->module = wasm_runtime_load(
        entry->bytes.data(),
        static_cast<uint32_t>(entry->bytes.size()),
        error_buf, sizeof(error_buf));
    if (!entry->module) {
        if (outError) *outError = std::string("WAMR load failed: ") + error_buf;
        return false;
    }

#if WASM_ENABLE_LIBC_WASI != 0
    // Modules compiled for WASI (C/C++ via `zig cc`, Go via wasip1) import
    // wasi_snapshot_preview1. Give them an empty sandbox — no preopened dirs,
    // no args, no env — which is enough for pure computation and grants no
    // filesystem access. On non-WASI modules (Rust, freestanding Zig) this is
    // stored but never used, because instantiation only sets up WASI when the
    // module actually imports it.
    wasm_runtime_set_wasi_args(entry->module,
                               nullptr, 0,   // preopened dirs
                               nullptr, 0,   // mapped dirs
                               nullptr, 0,   // environment
                               nullptr, 0);  // argv
#endif

    // Instantiate with a heap so cn_alloc / cn_free work.
    entry->instance = wasm_runtime_instantiate(
        entry->module, kStackSize, kHeapSize, error_buf, sizeof(error_buf));
    if (!entry->instance) {
        if (outError) *outError = std::string("WAMR instantiate failed: ") + error_buf;
        wasm_runtime_unload(entry->module);
        entry->module = nullptr;
        return false;
    }

    // Execution environment (one per module, protected by callMutex).
    entry->execEnv = wasm_runtime_create_exec_env(entry->instance, kStackSize);
    if (!entry->execEnv) {
        if (outError) *outError = "WAMR: failed to create exec_env";
        wasm_runtime_deinstantiate(entry->instance);
        wasm_runtime_unload(entry->module);
        entry->instance = nullptr;
        entry->module   = nullptr;
        return false;
    }

    // WASI *reactor* modules export `_initialize` (global constructors, and for
    // Go the runtime/scheduler bring-up) instead of `_start`. WAMR already runs
    // it during instantiation via execute_post_instantiate_functions, so we must
    // not call it again — Go in particular aborts with "randinit twice" if its
    // runtime is initialized more than once.

    // Enumerate exports to fill entry->functions.
    {
        const int32_t exportCount =
            wasm_runtime_get_export_count(entry->module);
        for (int32_t i = 0; i < exportCount; ++i) {
            wasm_export_t info{};
            wasm_runtime_get_export_type(entry->module, i, &info);
            if (info.kind == WASM_IMPORT_EXPORT_KIND_FUNC && info.name)
                entry->functions.emplace_back(info.name);
        }
    }

    // Read metadata / signatures from __cn_meta_* exports.
    readManifest(*entry);

    // Register
    {
        std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
        pImpl->modules[moduleId] = std::move(entry);
    }
    return true;
}

void WasmRuntime::unloadModule(const std::string& moduleId) {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    pImpl->modules.erase(moduleId);
    // ~ModuleEntry frees execEnv, instance, module.
}

std::string WasmRuntime::call(const std::string& moduleId,
                               const std::string& functionName,
                               const std::string& argsJson) {
    ensureThreadEnv();

    // ── Find module ──
    std::shared_ptr<ModuleEntry> entry;
    {
        std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
        auto it = pImpl->modules.find(moduleId);
        if (it == pImpl->modules.end())
            return errorResult("Module '" + moduleId + "' not loaded").dump();
        entry = it->second;
    }

    // ── Parse args ──
    json args;
    try { args = json::parse(argsJson); }
    catch (const json::exception& e) {
        return errorResult(std::string("invalid args JSON: ") + e.what()).dump();
    }
    if (!args.is_array())
        return errorResult("args must be a JSON array").dump();

    // ── Lock module ──
    std::lock_guard<std::mutex> callLock(entry->callMutex);

    // ── Find function ──
    wasm_function_inst_t func =
        wasm_runtime_lookup_function(entry->instance, functionName.c_str());
    if (!func)
        return errorResult("Function '" + functionName + "' not found in module '" +
                            moduleId + "'").dump();

    const uint32_t retCount =
        wasm_func_get_result_count(func, entry->instance);
    std::vector<wasm_val_t> rets(retCount ? retCount : 1);
    for (auto& r : rets) { r.kind = WASM_I64; r.of.i64 = 0; }

    // ── Bind arguments ──
    ArgumentBinder binder(*entry);
    std::string bindError;

    const auto sigIt = entry->signatures.find(functionName);
    bool typed = (sigIt != entry->signatures.end());

    bool bindOk = typed
        ? binder.bindTyped(func, args, sigIt->second, bindError)
        : binder.bind(func, args, bindError);
    if (!bindOk)
        return errorResult("argument binding: " + bindError).dump();

    // ── Call ──
    const auto& vals = binder.vals();
    bool callOk = wasm_runtime_call_wasm_a(
        entry->execEnv, func,
        retCount, rets.data(),
        static_cast<uint32_t>(vals.size()),
        vals.empty() ? nullptr : const_cast<wasm_val_t*>(vals.data()));

    if (!callOk) {
        const char* exc = wasm_runtime_get_exception(entry->instance);
        std::string msg = exc ? std::string("WASM call failed: ") + exc
                               : "WASM call failed (unknown)";
        wasm_runtime_clear_exception(entry->instance);
        return errorResult(msg).dump();
    }

    // ── Read outputs ──
    json outputs;
    std::string outputError;
    if (!binder.readOutputs(outputs, outputError))
        return errorResult("reading output buffers: " + outputError).dump();

    // ── Read return value ──
    json result;
    if (typed) {
        std::string retErr;
        result = readTypedReturn(*entry, func, sigIt->second.returns, rets, retErr);
        if (!retErr.empty())
            return errorResult("reading typed return: " + retErr).dump();
    } else {
        result = retCount > 0 ? readReturnValues(func, entry->instance, rets)
                              : nullptr;
    }

    // ── Build response ──
    json response;
    response["success"] = true;
    response["result"]  = result;
    response["outputs"] = outputs;
    return response.dump();
}

std::vector<std::string> WasmRuntime::getFunctions(const std::string& moduleId) const {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    auto it = pImpl->modules.find(moduleId);
    if (it == pImpl->modules.end()) return {};
    return it->second->functions;
}

std::string WasmRuntime::getManifest(const std::string& moduleId) const {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    auto it = pImpl->modules.find(moduleId);
    if (it == pImpl->modules.end()) return "[]";
    return it->second->manifestJson;
}

bool WasmRuntime::isLoaded(const std::string& moduleId) const {
    std::lock_guard<std::mutex> lock(pImpl->modulesMutex);
    return pImpl->modules.count(moduleId) > 0;
}

std::unordered_map<std::string, double> WasmRuntime::getStats() const {
    std::lock_guard<std::mutex> lock(pImpl->statsMutex);
    return {
        {"totalCallMs",  pImpl->totalCallMs},
        {"totalCalls",   static_cast<double>(pImpl->totalCalls)},
    };
}

// ─── Free helpers ─────────────────────────────────────────────────────────

std::vector<uint8_t> readWasmFile(const std::string& wasmPath) {
    std::ifstream file(wasmPath, std::ios::binary | std::ios::ate);
    if (!file) return {};
    const std::streamsize sz = file.tellg();
    file.seekg(0, std::ios::beg);
    std::vector<uint8_t> buf(static_cast<size_t>(sz));
    if (file.read(reinterpret_cast<char*>(buf.data()), sz)) return buf;
    return {};
}

std::shared_ptr<NativeModule> loadSharedLibrary(const std::string& /*moduleId*/,
                                                 const std::string& /*libraryPath*/) {
    return nullptr; // SharedLibraryModule not changed by this migration.
}

SharedBuffer::SharedBuffer(size_t size)
    : size_(size), data_(new uint8_t[size]()) {}
SharedBuffer::~SharedBuffer() = default;

} // namespace crossnative
