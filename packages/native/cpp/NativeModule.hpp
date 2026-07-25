#pragma once

#include "WasmRuntime.hpp"

#include <memory>
#include <string>
#include <vector>

namespace crossnative {

/**
 * Abstract interface for native modules
 *
 * Implemented by:
 * - WasmModule (for Rust/Go/Zig via WASM)
 * - SharedLibraryModule (for C++ via .so/.dylib)
 */
class NativeModule {
public:
  virtual ~NativeModule() = default;

  /** Get module identifier */
  virtual std::string getId() const = 0;

  /** Get source language */
  virtual std::string getLanguage() const = 0;

  /** List exported functions */
  virtual std::vector<std::string> getFunctions() const = 0;

  /** Declared signatures as JSON, or "[]" if the module has no metadata. */
  virtual std::string getManifest() const = 0;

  /** Call a function. Returns the runtime's JSON result envelope. */
  virtual std::string call(
    const std::string& functionName,
    const std::string& argsJson,
    bool zeroCopy = false
  ) = 0;

  /** Call a function synchronously (if supported) */
  virtual std::string callSync(
    const std::string& functionName,
    const std::string& argsJson
  ) = 0;

  /** Dispose and free resources */
  virtual void dispose() = 0;
};

/**
 * WASM-based native module.
 *
 * Holds a non-owning pointer to the runtime owned by CrossNative. The module's
 * WASM state lives inside that runtime, keyed by id.
 */
class WasmModule : public NativeModule {
public:
  WasmModule(const std::string& id, const std::string& language, WasmRuntime* runtime);
  ~WasmModule() override;

  std::string getId() const override { return id_; }
  std::string getLanguage() const override { return language_; }
  std::vector<std::string> getFunctions() const override;
  std::string getManifest() const override;
  std::string call(const std::string& functionName, const std::string& argsJson, bool zeroCopy) override;
  std::string callSync(const std::string& functionName, const std::string& argsJson) override;
  void dispose() override;

private:
  std::string id_;
  std::string language_;
  WasmRuntime* runtime_ = nullptr; // non-owning; owned by CrossNative
};

/**
 * Shared library native module.
 *
 * Loads a .so (Android) or .dylib (iOS) directly. The library must export:
 *
 *   const char* crossnative_call(const char* requestJson);
 *
 * where requestJson is {"function":"...","args":[...],"zeroCopy":bool} and the
 * returned string is the JSON result envelope. The returned pointer must stay
 * valid until the next call into the same library.
 */
class SharedLibraryModule : public NativeModule {
public:
  /// Load from a file via dlopen (Android .so, a dev .dylib).
  SharedLibraryModule(const std::string& id, const std::string& libraryPath);

  /// Resolve crossnative_call from the app itself (RTLD_DEFAULT), for a static
  /// library linked into the binary — the iOS path, where dlopen of arbitrary
  /// code is forbidden. `Linked` selects this overload. `suffix` disambiguates
  /// the entry symbols when more than one language is linked into one app: Rust
  /// exports `crossnative_call` (empty suffix), Zig `crossnative_call_zig`, etc.
  struct Linked { std::string suffix; };
  SharedLibraryModule(const std::string& id, Linked linked);

  ~SharedLibraryModule() override;

  std::string getId() const override { return id_; }
  std::string getLanguage() const override { return "rust"; }
  std::vector<std::string> getFunctions() const override;
  std::string getManifest() const override;
  std::string call(const std::string& functionName, const std::string& argsJson, bool zeroCopy) override;
  std::string callSync(const std::string& functionName, const std::string& argsJson) override;
  void dispose() override;

private:
  std::string id_;
  std::string libraryPath_;
  void* handle_ = nullptr; // dlopen handle

  using CallFunc = const char* (*)(const char*);
  using ManifestFunc = const char* (*)();
  CallFunc callFunc_ = nullptr;
  ManifestFunc manifestFunc_ = nullptr;
};

} // namespace crossnative
