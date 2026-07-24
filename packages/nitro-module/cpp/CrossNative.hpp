#pragma once

#include "json.hpp"
#include "WasmRuntime.hpp"
#include "ThreadPool.hpp"
#include "NativeModule.hpp"
#include <iostream>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <future>
#include <optional>
#include <functional>

namespace crossnative {

// Forward declarations
struct CallOptions {
    std::optional<int> priority;
    std::optional<int> timeout;
    std::optional<bool> zeroCopy;
};

struct ExecutionMetrics {
    double executionTime = 0;
    double queueTime = 0;
    std::string threadId;
};

struct NativeResult {
    bool success = false;
    std::string data;
    std::string error;
    ExecutionMetrics metrics;
};

/**
 * Mixed case deliberately: iOS Debug builds define a DEBUG macro, and several
 * platform headers define ERROR, so uppercase enumerators do not survive
 * preprocessing.
 */
enum class LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3
};

/**
 * Serialise a result into the JSON envelope every binding hands to JavaScript:
 *
 *   {"success":true,"result":...,"outputs":[...],"metrics":{...}}
 *   {"success":false,"error":"..."}
 */
std::string toEnvelopeJson(const NativeResult& result);

/**
 * CrossNative implementation - main native module
 */
class CrossNative {
public:
    CrossNative();
    ~CrossNative();

    // Module management

    /**
     * Load a module from a file path.
     *
     * For WASM languages the path names a compiled .wasm; for "cpp" it names a
     * shared library. Prefer loadModuleFromBytes on mobile, where an app's
     * assets are not always reachable as filesystem paths.
     */
    std::future<bool> loadModule(
        const std::string& moduleId,
        const std::string& language,
        const std::string& sourcePath
    );

    /**
     * Load a WASM module from bytes already in memory.
     *
     * This is how modules arrive on device: JavaScript hands over an
     * ArrayBuffer, so nothing depends on the platform's file layout.
     */
    std::future<bool> loadModuleFromBytes(
        const std::string& moduleId,
        const std::string& language,
        std::vector<uint8_t> wasmBytes
    );

    std::future<NativeResult> callFunction(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson,
        const std::optional<CallOptions>& options = std::nullopt
    );

    /**
     * Call a function, delivering the result to a callback.
     *
     * The callback runs on the worker thread that performed the call. Bindings
     * that must not block — the JSI layer in particular — use this so no thread
     * sits waiting on a future.
     */
    void callFunctionAsync(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson,
        const std::optional<CallOptions>& options,
        std::function<void(NativeResult)> callback
    );

    /** Byte-loading with a callback, for the same reason as callFunctionAsync. */
    void loadModuleFromBytesAsync(
        const std::string& moduleId,
        const std::string& language,
        std::vector<uint8_t> wasmBytes,
        std::function<void(bool, std::string)> callback
    );

    NativeResult callFunctionSync(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson
    );
    
    void unloadModule(const std::string& moduleId);
    bool isModuleLoaded(const std::string& moduleId);
    std::vector<std::string> getModuleFunctions(const std::string& moduleId);

    /**
     * The module's declared signatures as JSON.
     *
     * Bindings hand this to JavaScript so it can build named, typed functions
     * instead of calling by string with hand-marshalled arguments.
     */
    std::string getModuleManifest(const std::string& moduleId);

    // Shared memory
    std::string createSharedBuffer(size_t size);
    void releaseSharedBuffer(const std::string& bufferId);

    // Stats and logging
    std::unordered_map<std::string, double> getStats();
    void setLogLevel(const std::string& level);

private:
    std::unique_ptr<WasmRuntime> wasmRuntime_;
    std::unique_ptr<ThreadPool> threadPool_;
    
    std::mutex modulesMutex_;
    std::unordered_map<std::string, std::shared_ptr<NativeModule>> modules_;
    
    std::mutex buffersMutex_;
    std::unordered_map<std::string, std::shared_ptr<SharedBuffer>> buffers_;
    int nextBufferId_ = 0;
    
    LogLevel logLevel_ = LogLevel::Info;

    void log(LogLevel level, const std::string& message);

    /** Load WASM bytes into the runtime and register the module. Throws on failure. */
    void installWasmModule(
        const std::string& moduleId,
        const std::string& language,
        const std::vector<uint8_t>& wasmBytes
    );

    /** Open a shared library and register it. Throws on failure. */
    void installSharedLibrary(
        const std::string& moduleId,
        const std::string& libraryPath
    );

    void registerModule(const std::string& moduleId, std::shared_ptr<NativeModule> module);

    /** Per-call settings, after defaults are applied. */
    struct CallSettings {
        TaskPriority priority = TaskPriority::NORMAL;
        bool zeroCopy = false;
    };
    static CallSettings resolveSettings(const std::optional<CallOptions>& options);

    /** Perform a call on the current (worker) thread. */
    NativeResult executeCall(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson,
        bool zeroCopy
    );
};

} // namespace crossnative
