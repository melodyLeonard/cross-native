#pragma once

// Minimal test reporting. The core has no third-party test dependency, so the
// suite carries the few helpers it needs.

#include <cmath>
#include <iostream>
#include <string>

namespace crossnative::test {

inline int gPassed = 0;
inline int gFailed = 0;

/// Record one assertion and print it.
inline void report(const std::string& name, bool ok, const std::string& detail = "") {
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

inline void section(const std::string& title) {
  std::cout << "\n" << title << std::endl;
}

inline bool nearlyEqual(double a, double b, double eps = 1e-9) {
  return std::fabs(a - b) < eps;
}

/// Print the tally and return a process exit code.
inline int summarize() {
  std::cout << "\n" << gPassed << " passed, " << gFailed << " failed" << std::endl;
  return gFailed == 0 ? 0 : 1;
}

} // namespace crossnative::test
