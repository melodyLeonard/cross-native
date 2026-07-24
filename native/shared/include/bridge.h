#pragma once

#include <jsi/jsi.h>
#include <memory>
#include <string>
#include <unordered_map>
#include <future>
#include <vector>

namespace crossnative {

using namespace facebook::jsi;

// Forward declarations
class ThreadPool;
struct NativeModule;

/**
 * JSI Bridge - Core communication layer between JS and native code
 * 
 * Provides:
 * - Synchronous calls for fast operations
 * - Asynchronous calls with thread pool dispatch
 * - Zero-copy shared memory via ArrayBuffer
 * - Automatic type marshalling
 */
class JsiBridge {
public:
    explicit JsiBridge(Runtime& runtime);
    ~JsiBridge();

    // Initialize the bridge and install JS bindings
    void initialize();
    
    // Synchronous call - runs on JS thread, suitable for small/fast operations
    Value callSync(
        const std::string& moduleId,
        const std::string& methodId,
        const Value& args
    );
    
    // Asynchronous call - dispatched to worker thread, returns Promise
    std::future<Value> callAsync(
        const std::string& moduleId,
        const std::string& methodId,
        const Value& args,
        int priority = 1  // 0=immediate, 1=normal, 2=low
    );
    
    // Create a shared ArrayBuffer for zero-copy data transfer
    std::shared_ptr<ArrayBuffer> createSharedBuffer(size_t size);
    
    // Register a native module
    void registerModule(const std::string& id, std::shared_ptr<NativeModule> module);
    
    // Unregister and cleanup
    void unregisterModule(const std::string& id);
    
    // Check if a module is registered
    bool hasModule(const std::string& id) const;

private:
    Runtime& runtime_;
    std::unique_ptr<ThreadPool> threadPool_;
    std::unordered_map<std::string, std::shared_ptr<NativeModule>> modules_;
    
    // Install global.__CROSS_NATIVE_CALL__ function
    void installJSBindings();
    
    // Promise creation helpers
    Object createPromise(std::function<void(Function, Function)>
    executor);
    void resolvePromise(const Object& promise, const Value& value);
    void rejectPromise(const Object& promise, const std::string& error);
};

/**
 * NativeModule interface - implemented by language-specific bindings
 */
struct NativeModule {
    virtual ~NativeModule() = default;
    
    // Get module metadata
    virtual std::string getName() const = 0;
    virtual std::string getLanguage() const = 0;
    virtual std::vector<std::string> getMethods() const = 0;
    
    // Call a method synchronously
    virtual Value callSync(
        Runtime& rt,
        const std::string& method,
        const Value& args
    ) = 0;
    
    // Call a method asynchronously (returns future)
    virtual std::future<Value> callAsync(
        Runtime& rt,
        const std::string& method,
        const Value& args
    ) = 0;
};

} // namespace crossnative
