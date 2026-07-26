#pragma once

#include <memory>
#include <string>
#include <vector>
#include <unordered_map>

namespace crossnative {

/**
 * WASM Runtime - Sandboxed execution environment
 *
 * Uses wasm3 to execute compiled code from any language that targets WASM
 * (Rust, Go, C++, Zig).
 *
 * Benefits:
 * - Memory safe (a misbehaving module traps instead of crashing the app)
 * - Sandboxed (no direct system access)
 * - Portable (the same .wasm runs on iOS and Android)
 * - Language agnostic
 *
 * Tradeoffs:
 * - wasm3 is an interpreter, so it is slower than a JIT or native code
 * - No SIMD
 *
 * Threading: each module gets its own IM3Runtime. wasm3 runtimes are not
 * thread-safe, so calls into a single module are serialised by a per-module
 * mutex. Different modules can execute concurrently.
 */
class WasmRuntime {
public:
  WasmRuntime();
  ~WasmRuntime();

  WasmRuntime(const WasmRuntime&) = delete;
  WasmRuntime& operator=(const WasmRuntime&) = delete;

  /**
   * Load a WASM module.
   *
   * @param moduleId Unique identifier
   * @param wasmBytes Compiled WASM binary (copied and retained internally)
   * @param outError Populated with a human-readable reason on failure
   * @return Success
   */
  bool loadModule(const std::string& moduleId,
                  const std::vector<uint8_t>& wasmBytes,
                  std::string* outError = nullptr);

  /**
   * Unload a module and release its runtime.
   */
  void unloadModule(const std::string& moduleId);

  /**
   * Call a function in a loaded module.
   *
   * Arguments are a JSON array. Each element is either:
   *   - a number, coerced to the parameter type declared by the WASM signature
   *   - {"in":    [...], "type": "f64"} copy the array into WASM memory,
   *                                     pass the pointer
   *   - {"out":   count, "type": "f64"} allocate a zeroed buffer, pass the
   *                                     pointer, read it back afterwards
   *   - {"inout": [...], "type": "f64"} copy in, pass the pointer, read back
   *
   * Buffer arguments require the module to export `cn_alloc` and `cn_free`.
   *
   * @return JSON: {"success":true,"result":<value|null>,"outputs":[[...]]}
   *            or {"success":false,"error":"..."}
   */
  std::string call(const std::string& moduleId,
                   const std::string& functionName,
                   const std::string& argsJson);

  /**
   * Get the list of exported functions, parsed from the WASM export section.
   */
  std::vector<std::string> getFunctions(const std::string& moduleId) const;

  /**
   * Get the module's declared signatures as a JSON array.
   *
   * Populated from the `__cn_meta_*` exports that #[crossnative] emits. Empty
   * for modules built without the macro, which are still callable through the
   * raw buffer protocol.
   */
  std::string getManifest(const std::string& moduleId) const;

  /**
   * Check if a module is loaded.
   */
  bool isLoaded(const std::string& moduleId) const;

private:
  struct Impl;
  std::unique_ptr<Impl> pImpl; // PIMPL to keep wasm3 out of the public header
};

class NativeModule; // Forward declaration

/**
 * Read a compiled .wasm file from disk.
 *
 * Compiling source (.rs, .go) to WASM is the CLI's job — by the time the
 * runtime sees a module it is already a WASM binary.
 *
 * @return File bytes, or an empty vector if the file could not be read
 */
std::vector<uint8_t> readWasmFile(const std::string& wasmPath);

/**
 * Load a shared library (.so/.dylib) exposing the CrossNative C ABI.
 *
 * @return Loaded module, or nullptr if the library could not be loaded
 */
std::shared_ptr<NativeModule> loadSharedLibrary(const std::string& moduleId,
                                                const std::string& libraryPath);

/**
 * Shared memory buffer for zero-copy data transfer
 */
class SharedBuffer {
public:
  explicit SharedBuffer(size_t size);
  ~SharedBuffer();

  uint8_t* data() { return data_.get(); }
  const uint8_t* data() const { return data_.get(); }
  size_t size() const { return size_; }

private:
  std::unique_ptr<uint8_t[]> data_;
  size_t size_;
};

} // namespace crossnative
