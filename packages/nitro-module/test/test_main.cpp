// CrossNative core test harness
//
// Loads a real Rust-compiled .wasm through the full CrossNative stack
// (thread pool -> WasmModule -> WasmRuntime -> wasm3) and checks results.
//
// Usage: ./test_runner <path-to-compute.wasm>

#include "../cpp/CrossNative.hpp"
#include "../cpp/json.hpp"

#include <chrono>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

using json = nlohmann::json;
using namespace crossnative;

namespace {

int gPassed = 0;
int gFailed = 0;

void report(const std::string& name, bool ok, const std::string& detail = "") {
  if (ok) {
    ++gPassed;
    std::cout << "  \033[32mPASS\033[0m  " << name;
  } else {
    ++gFailed;
    std::cout << "  \033[31mFAIL\033[0m  " << name;
  }
  if (!detail.empty()) std::cout << "  (" << detail << ")";
  std::cout << std::endl;
}

bool nearlyEqual(double a, double b, double eps = 1e-9) {
  return std::fabs(a - b) < eps;
}

/// Run a call through CrossNative and return the parsed payload.
/// Reports a failure and returns nullopt if the call did not succeed.
std::optional<json> callOk(CrossNative& cn, const std::string& name,
                           const std::string& fn, const json& args) {
  auto result = cn.callFunction("compute", fn, args.dump()).get();
  if (!result.success) {
    report(name, false, result.error);
    return std::nullopt;
  }
  return json::parse(result.data);
}

void expectNumber(CrossNative& cn, const std::string& name,
                  const std::string& fn, const json& args, double expected) {
  auto payload = callOk(cn, name, fn, args);
  if (!payload) return;

  const json& value = (*payload)["result"];
  if (!value.is_number()) {
    report(name, false, "result was not a number: " + value.dump());
    return;
  }

  double actual = value.get<double>();
  std::ostringstream detail;
  detail << std::setprecision(12) << actual;
  report(name, nearlyEqual(actual, expected, 1e-6),
         nearlyEqual(actual, expected, 1e-6)
             ? detail.str()
             : "expected " + std::to_string(expected) + ", got " + detail.str());
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

  // --- Module loading --------------------------------------------------------
  std::cout << "Module loading" << std::endl;
  bool loaded = cn.loadModule("compute", "rust", wasmPath).get();
  report("loads a Rust-compiled WASM module", loaded);
  if (!loaded) {
    std::cerr << "\nCannot continue without a loaded module." << std::endl;
    return 1;
  }

  report("reports the module as loaded", cn.isModuleLoaded("compute"));

  auto functions = cn.getModuleFunctions("compute");
  bool hasExports = std::find(functions.begin(), functions.end(), "add") != functions.end() &&
                    std::find(functions.begin(), functions.end(), "matrix_multiply") != functions.end();
  report("enumerates exported functions", hasExports,
         std::to_string(functions.size()) + " exports");

  // --- Scalar calls ----------------------------------------------------------
  std::cout << "\nScalar functions" << std::endl;
  expectNumber(cn, "add(1.5, 2.5) == 4", "add", json::array({1.5, 2.5}), 4.0);
  expectNumber(cn, "multiply(3, 4) == 12", "multiply", json::array({3.0, 4.0}), 12.0);
  expectNumber(cn, "factorial(10) == 3628800", "factorial", json::array({10}), 3628800.0);
  expectNumber(cn, "fibonacci(20) == 6765", "fibonacci", json::array({20}), 6765.0);

  // --- Error handling --------------------------------------------------------
  std::cout << "\nError handling" << std::endl;
  {
    auto r = cn.callFunction("compute", "does_not_exist", "[]").get();
    report("missing function reports failure", !r.success, r.error);
  }
  {
    auto r = cn.callFunction("nope", "add", "[1,2]").get();
    report("missing module reports failure", !r.success, r.error);
  }
  {
    // add takes two arguments; passing one must be rejected, not crash.
    auto r = cn.callFunction("compute", "add", "[1]").get();
    report("argument count mismatch reports failure", !r.success, r.error);
  }

  // --- Buffer arguments ------------------------------------------------------
  std::cout << "\nArray arguments (WASM linear memory)" << std::endl;
  {
    json args = json::array();
    args.push_back({{"in", json::array({1.0, 2.0, 3.0, 4.0, 5.0})}, {"type", "f64"}});
    args.push_back(5);
    expectNumber(cn, "sum_array([1..5]) == 15", "sum_array", args, 15.0);
  }

  {
    // 2x2 identity * [[1,2],[3,4]] == [[1,2],[3,4]]
    json a = json::array({1.0, 0.0, 0.0, 1.0});
    json b = json::array({1.0, 2.0, 3.0, 4.0});
    json args = json::array();
    args.push_back({{"in", a}, {"type", "f64"}});
    args.push_back({{"in", b}, {"type", "f64"}});
    args.push_back({{"out", 4}, {"type", "f64"}});
    args.push_back(2);

    auto payload = callOk(cn, "matrix_multiply writes an output buffer", "matrix_multiply", args);
    if (payload) {
      auto outputs = (*payload)["outputs"];
      bool ok = outputs.size() == 1 && outputs[0] == json::array({1.0, 2.0, 3.0, 4.0});
      report("matrix_multiply identity gives back the input", ok,
             ok ? "" : outputs.dump());
    }
  }

  {
    // process_dataset mutates in place: verify against the same formula in C++.
    std::vector<double> input = {1.0, 2.0, 3.0, 4.0};
    json args = json::array();
    args.push_back({{"inout", input}, {"type", "f64"}});
    args.push_back(static_cast<int>(input.size()));

    auto payload = callOk(cn, "process_dataset mutates in place", "process_dataset", args);
    if (payload) {
      auto outputs = (*payload)["outputs"];
      bool ok = outputs.size() == 1 && outputs[0].size() == input.size();
      if (ok) {
        for (size_t i = 0; i < input.size(); ++i) {
          double x = input[i];
          double expected = std::sin(std::sqrt(x)) * std::cos(x) + std::log1p(x);
          if (!nearlyEqual(outputs[0][i].get<double>(), expected, 1e-9)) {
            ok = false;
            break;
          }
        }
      }
      report("process_dataset matches the reference formula", ok,
             ok ? "" : outputs.dump());
    }
  }

  // --- Threading -------------------------------------------------------------
  std::cout << "\nConcurrency" << std::endl;
  {
    // Fire many calls at once. wasm3 runtimes are not thread-safe, so this is
    // really a test that the per-module lock serialises them correctly.
    constexpr int kCalls = 64;
    std::vector<std::future<NativeResult>> futures;
    futures.reserve(kCalls);
    for (int i = 0; i < kCalls; ++i) {
      futures.push_back(cn.callFunction("compute", "add", json::array({i, i}).dump()));
    }

    bool allOk = true;
    for (int i = 0; i < kCalls; ++i) {
      auto r = futures[i].get();
      if (!r.success || json::parse(r.data)["result"].get<double>() != i * 2) {
        allOk = false;
        break;
      }
    }
    report("64 concurrent calls all return correct results", allOk);
  }

  // --- Performance sanity ----------------------------------------------------
  std::cout << "\nPerformance (wasm3 interpreter)" << std::endl;
  {
    const int n = 60;
    json a = json::array(), b = json::array();
    for (int i = 0; i < n * n; ++i) {
      a.push_back(static_cast<double>(i % 7));
      b.push_back(static_cast<double>(i % 5));
    }
    json args = json::array();
    args.push_back({{"in", a}, {"type", "f64"}});
    args.push_back({{"in", b}, {"type", "f64"}});
    args.push_back({{"out", n * n}, {"type", "f64"}});
    args.push_back(n);

    auto start = std::chrono::high_resolution_clock::now();
    auto r = cn.callFunction("compute", "matrix_multiply", args.dump()).get();
    auto ms = std::chrono::duration<double, std::milli>(
                  std::chrono::high_resolution_clock::now() - start).count();

    std::ostringstream detail;
    detail << std::fixed << std::setprecision(1) << ms << "ms for " << n << "x" << n;
    report("matrix_multiply 60x60 completes", r.success, r.success ? detail.str() : r.error);
  }

  // --- Unload ----------------------------------------------------------------
  std::cout << "\nCleanup" << std::endl;
  cn.unloadModule("compute");
  report("unloads the module", !cn.isModuleLoaded("compute"));
  {
    auto r = cn.callFunction("compute", "add", "[1,2]").get();
    report("calling an unloaded module fails cleanly", !r.success, r.error);
  }

  // --- Summary ---------------------------------------------------------------
  std::cout << "\n" << gPassed << " passed, " << gFailed << " failed" << std::endl;
  return gFailed == 0 ? 0 : 1;
}
