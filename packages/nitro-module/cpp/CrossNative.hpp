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

enum class LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
};

/**
 * CrossNative implementation - main native module
 */
class CrossNative {
public:
    CrossNative();
    ~CrossNative();

    // Module management
    std::future<bool> loadModule(
        const std::string& moduleId,
        const std::string& language,
        const std::string& sourcePath
    );
    
    std::future<NativeResult> callFunction(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson,
        const std::optional<CallOptions>& options = std::nullopt
    );
    
    NativeResult callFunctionSync(
        const std::string& moduleId,
        const std::string& functionName,
        const std::string& argsJson
    );
    
    void unloadModule(const std::string& moduleId);
    bool isModuleLoaded(const std::string& moduleId);
    std::vector<std::string> getModuleFunctions(const std::string& moduleId);

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
    
    LogLevel logLevel_ = LogLevel::INFO;
    
    void log(LogLevel level, const std::string& message);
};

} // namespace crossnative
