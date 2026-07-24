// CrossNative core test suite
//
// Loads a real Rust-compiled .wasm through the full stack (thread pool ->
// WasmModule -> WasmRuntime -> wasm3) and checks the results.
//
// Usage: ./test_runner <path-to-compute.wasm>

#include "../cpp/CrossNative.hpp"
#include "../cpp/json.hpp"
#include "harness.hpp"

#include <algorithm>
#include <chrono>
#include <iomanip>
#include <optional>
#include <sstream>
#include <vector>

using json = nlohmann::json;
using namespace crossnative;
using namespace crossnative::test;

namespace {

constexpr const char* kModuleId = "compute";

/// Run a call and return the parsed payload, reporting a failure if it errored.
std::optional<json> callOk(CrossNative& cn, const std::string& name,
                           const std::string& fn, const json& args) {
  auto result = cn.callFunction(kModuleId, fn, args.dump()).get();
  if (!result.success) {
    report(name, false, result.error);
    return std::nullopt;
  }
  return json::parse(result.data);
}

/// Assert a function returns a specific number.
void expectNumber(CrossNative& cn, const std::string& name, const std::string& fn,
                  const json& args, double expected) {
  auto payload = callOk(cn, name, fn, args);
  if (!payload) return;

  const json& value = (*payload)["result"];
  if (!value.is_number()) {
    report(name, false, "result was not a number: " + value.dump());
    return;
  }

  const double actual = value.get<double>();
  std::ostringstream detail;
  detail << std::setprecision(12) << actual;

  const bool ok = nearlyEqual(actual, expected, 1e-6);
  report(name, ok, ok ? detail.str()
                      : "expected " + std::to_string(expected) +
                        ", got " + detail.str());
}

void testModuleLoading(CrossNative& cn) {
  report("reports the module as loaded", cn.isModuleLoaded(kModuleId));

  auto functions = cn.getModuleFunctions(kModuleId);
  const bool hasExports =
      std::find(functions.begin(), functions.end(), "add") != functions.end() &&
      std::find(functions.begin(), functions.end(), "matrix_multiply") != functions.end();

  report("enumerates exported functions", hasExports,
         std::to_string(functions.size()) + " exports");
}

/// Loading from memory is the path the device build uses, so it gets its own
/// module id and is checked to actually execute.
void testLoadFromBytes(CrossNative& cn, const std::string& wasmPath) {
  section("Loading from bytes");

  auto bytes = readWasmFile(wasmPath);
  report("reads the WASM file", !bytes.empty(),
         std::to_string(bytes.size()) + " bytes");
  if (bytes.empty()) return;

  const bool loaded = cn.loadModuleFromBytes("from_bytes", "rust", bytes).get();
  report("loads a module from a byte buffer", loaded);
  if (!loaded) return;

  auto result = cn.callFunction("from_bytes", "add", "[2,3]").get();
  const bool ok = result.success &&
                  json::parse(result.data)["result"].get<double>() == 5.0;
  report("a byte-loaded module executes", ok, ok ? "" : result.error);

  // Two runtimes for the same binary must stay independent.
  report("coexists with the path-loaded module", cn.isModuleLoaded(kModuleId));
  cn.unloadModule("from_bytes");
}

void testScalars(CrossNative& cn) {
  section("Scalar functions");
  expectNumber(cn, "add(1.5, 2.5) == 4", "add", json::array({1.5, 2.5}), 4.0);
  expectNumber(cn, "multiply(3, 4) == 12", "multiply", json::array({3.0, 4.0}), 12.0);
  expectNumber(cn, "factorial(10) == 3628800", "factorial", json::array({10}), 3628800.0);
  expectNumber(cn, "fibonacci(20) == 6765", "fibonacci", json::array({20}), 6765.0);
}

void testErrorHandling(CrossNative& cn) {
  section("Error handling");

  auto missingFn = cn.callFunction(kModuleId, "does_not_exist", "[]").get();
  report("missing function reports failure", !missingFn.success, missingFn.error);

  auto missingModule = cn.callFunction("nope", "add", "[1,2]").get();
  report("missing module reports failure", !missingModule.success, missingModule.error);

  // add takes two arguments; passing one must be rejected, not crash.
  auto badArity = cn.callFunction(kModuleId, "add", "[1]").get();
  report("argument count mismatch reports failure", !badArity.success, badArity.error);
}

void testArrayArguments(CrossNative& cn) {
  // The array is the argument. No pointer, no length, no buffer wrapper.
  json args = json::array({json::array({1.0, 2.0, 3.0, 4.0, 5.0})});
  expectNumber(cn, "sum_array([1..5]) == 15", "sum_array", args, 15.0);
}

void testArrayReturns(CrossNative& cn) {
  // 2x2 identity * [[1,2],[3,4]] == [[1,2],[3,4]], returned directly.
  json args = json::array({
    json::array({1.0, 0.0, 0.0, 1.0}),
    json::array({1.0, 2.0, 3.0, 4.0}),
  });

  auto payload = callOk(cn, "matrix_multiply returns an array", "matrix_multiply", args);
  if (!payload) return;

  const json& result = (*payload)["result"];
  const bool ok = result == json::array({1.0, 2.0, 3.0, 4.0});
  report("matrix_multiply identity gives back the input", ok, result.dump());
}

void testStrings(CrossNative& cn) {
  auto payload = callOk(cn, "greet round-trips a string", "greet",
                        json::array({"world"}));
  if (!payload) return;

  const json& result = (*payload)["result"];
  const bool ok = result.is_string() && result.get<std::string>() == "Hello, world!";
  report("greet(\"world\") == \"Hello, world!\"", ok, result.dump());
}

void testTransform(CrossNative& cn) {
  const std::vector<double> input = {1.0, 2.0, 3.0, 4.0};

  auto payload = callOk(cn, "process_dataset returns a transformed array",
                        "process_dataset", json::array({input}));
  if (!payload) return;

  const json& result = (*payload)["result"];
  bool ok = result.is_array() && result.size() == input.size();
  for (size_t i = 0; ok && i < input.size(); ++i) {
    const double x = input[i];
    const double expected = std::sin(std::sqrt(x)) * std::cos(x) + std::log1p(x);
    ok = nearlyEqual(result[i].get<double>(), expected);
  }

  report("process_dataset matches the reference formula", ok, ok ? "" : result.dump());
}

void testConcurrency(CrossNative& cn) {
  section("Concurrency");

  // Fire many calls at once. wasm3 runtimes are not thread-safe, so this is
  // really a test that the per-module lock serialises them correctly.
  constexpr int kCalls = 64;
  std::vector<std::future<NativeResult>> futures;
  futures.reserve(kCalls);

  for (int i = 0; i < kCalls; ++i) {
    futures.push_back(cn.callFunction(kModuleId, "add", json::array({i, i}).dump()));
  }

  bool allOk = true;
  for (int i = 0; i < kCalls && allOk; ++i) {
    auto r = futures[i].get();
    allOk = r.success && json::parse(r.data)["result"].get<double>() == i * 2;
  }

  report("64 concurrent calls all return correct results", allOk);
}

void testPerformance(CrossNative& cn) {
  section("Performance (wasm3 interpreter)");

  const int n = 60;
  json a = json::array();
  json b = json::array();
  for (int i = 0; i < n * n; ++i) {
    a.push_back(static_cast<double>(i % 7));
    b.push_back(static_cast<double>(i % 5));
  }

  json args = json::array({a, b});

  const auto start = std::chrono::high_resolution_clock::now();
  auto r = cn.callFunction(kModuleId, "matrix_multiply", args.dump()).get();
  const auto ms = std::chrono::duration<double, std::milli>(
      std::chrono::high_resolution_clock::now() - start).count();

  std::ostringstream detail;
  detail << std::fixed << std::setprecision(1) << ms << "ms for " << n << "x" << n;
  report("matrix_multiply 60x60 completes", r.success, r.success ? detail.str() : r.error);
}

void testCleanup(CrossNative& cn) {
  section("Cleanup");

  cn.unloadModule(kModuleId);
  report("unloads the module", !cn.isModuleLoaded(kModuleId));

  auto r = cn.callFunction(kModuleId, "add", "[1,2]").get();
  report("calling an unloaded module fails cleanly", !r.success, r.error);
}

} // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: " << argv[0] << " <path-to-compute.wasm>" << std::endl;
    return 2;
  }
  const std::string wasmPath = argv[1];

  std::cout << "\nCrossNative core test suite" << std::endl;
  std::cout << "wasm: " << wasmPath << "\n" << std::endl;

  CrossNative cn;

  section("Module loading");
  if (!cn.loadModule(kModuleId, "rust", wasmPath).get()) {
    report("loads a Rust-compiled WASM module", false);
    std::cerr << "\nCannot continue without a loaded module." << std::endl;
    return 1;
  }
  report("loads a Rust-compiled WASM module", true);
  testModuleLoading(cn);

  testLoadFromBytes(cn, wasmPath);
  testScalars(cn);
  testErrorHandling(cn);

  section("Typed arguments (from the module's own manifest)");
  testArrayArguments(cn);
  testArrayReturns(cn);
  testTransform(cn);
  testStrings(cn);

  testConcurrency(cn);
  testPerformance(cn);
  testCleanup(cn);

  return summarize();
}
