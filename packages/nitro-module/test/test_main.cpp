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

/// Build a buffer argument: {"in"|"out"|"inout": ..., "type": "f64"}.
json buffer(const char* mode, const json& value) {
  return json{{mode, value}, {"type", "f64"}};
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

void testInputBuffers(CrossNative& cn) {
  json args = json::array();
  args.push_back(buffer("in", json::array({1.0, 2.0, 3.0, 4.0, 5.0})));
  args.push_back(5);
  expectNumber(cn, "sum_array([1..5]) == 15", "sum_array", args, 15.0);
}

void testOutputBuffers(CrossNative& cn) {
  // 2x2 identity * [[1,2],[3,4]] == [[1,2],[3,4]]
  json args = json::array();
  args.push_back(buffer("in", json::array({1.0, 0.0, 0.0, 1.0})));
  args.push_back(buffer("in", json::array({1.0, 2.0, 3.0, 4.0})));
  args.push_back(buffer("out", 4));
  args.push_back(2);

  auto payload = callOk(cn, "matrix_multiply writes an output buffer",
                        "matrix_multiply", args);
  if (!payload) return;

  auto outputs = (*payload)["outputs"];
  const bool ok = outputs.size() == 1 &&
                  outputs[0] == json::array({1.0, 2.0, 3.0, 4.0});
  report("matrix_multiply identity gives back the input", ok, ok ? "" : outputs.dump());
}

void testInOutBuffers(CrossNative& cn) {
  // process_dataset mutates in place: verify against the same formula in C++.
  const std::vector<double> input = {1.0, 2.0, 3.0, 4.0};

  json args = json::array();
  args.push_back(buffer("inout", input));
  args.push_back(static_cast<int>(input.size()));

  auto payload = callOk(cn, "process_dataset mutates in place", "process_dataset", args);
  if (!payload) return;

  auto outputs = (*payload)["outputs"];
  bool ok = outputs.size() == 1 && outputs[0].size() == input.size();
  for (size_t i = 0; ok && i < input.size(); ++i) {
    const double x = input[i];
    const double expected = std::sin(std::sqrt(x)) * std::cos(x) + std::log1p(x);
    ok = nearlyEqual(outputs[0][i].get<double>(), expected);
  }

  report("process_dataset matches the reference formula", ok, ok ? "" : outputs.dump());
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

  json args = json::array();
  args.push_back(buffer("in", a));
  args.push_back(buffer("in", b));
  args.push_back(buffer("out", n * n));
  args.push_back(n);

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

  testScalars(cn);
  testErrorHandling(cn);

  section("Array arguments (WASM linear memory)");
  testInputBuffers(cn);
  testOutputBuffers(cn);
  testInOutBuffers(cn);

  testConcurrency(cn);
  testPerformance(cn);
  testCleanup(cn);

  return summarize();
}
