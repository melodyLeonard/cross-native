// CrossNative host — exposes the C++ core over line-delimited JSON on stdio.
//
// This is a development harness. It lets the TypeScript package drive the real
// thread pool and WASM runtime from Node, so the JS API can be exercised and
// benchmarked without a React Native build. On device, the same core is reached
// through JSI instead of this process.
//
// Protocol: one JSON object per line, in and out.
//
//   -> {"id":1,"op":"load","moduleId":"compute","language":"rust","path":"a.wasm"}
//   <- {"id":1,"success":true,"functions":[...]}
//
//   -> {"id":2,"op":"call","moduleId":"compute","function":"add","args":[1,2]}
//   <- {"id":2,"success":true,"result":3,"outputs":[],"metrics":{...}}
//
// Calls are dispatched to the thread pool and answered as they complete, so
// responses may arrive out of order. Match them by id.

#include "../cpp/CrossNative.hpp"
#include "../cpp/json.hpp"

#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::json;
using namespace crossnative;

namespace {

std::mutex gOutputMutex;

/// Write one response line. Safe to call from any thread.
void respond(const json& response) {
  std::lock_guard<std::mutex> lock(gOutputMutex);
  std::cout << response.dump() << std::endl;
}

json ok(const json& id) {
  json r;
  r["id"] = id;
  r["success"] = true;
  return r;
}

void respondError(const json& id, const std::string& message) {
  json r;
  r["id"] = id;
  r["success"] = false;
  r["error"] = message;
  respond(r);
}

TaskPriority parsePriority(const std::string& name) {
  if (name == "immediate") return TaskPriority::IMMEDIATE;
  if (name == "high") return TaskPriority::HIGH;
  if (name == "low") return TaskPriority::LOW;
  if (name == "background") return TaskPriority::BACKGROUND;
  return TaskPriority::NORMAL;
}

/// Turn a NativeResult into a response object, flattening the payload.
json toResponse(const json& id, const NativeResult& result) {
  json r;
  r["id"] = id;
  r["success"] = result.success;

  if (!result.success) {
    r["error"] = result.error;
    return r;
  }

  try {
    auto payload = json::parse(result.data);
    r["result"] = payload.value("result", json());
    r["outputs"] = payload.value("outputs", json::array());
  } catch (const std::exception& e) {
    r["success"] = false;
    r["error"] = std::string("Malformed payload: ") + e.what();
    return r;
  }

  r["metrics"] = {
    {"executionTime", result.metrics.executionTime},
    {"queueTime", result.metrics.queueTime},
    {"threadId", result.metrics.threadId},
  };
  return r;
}

/**
 * Owns the CrossNative instance and the threads waiting on in-flight calls.
 */
class Host {
public:
  /// Read requests until stdin closes, then drain outstanding calls.
  void run();

private:
  /// Dispatch one parsed request. Returns false if the op was unknown.
  bool dispatch(const json& request, const json& id, const std::string& op);

  void handleLoad(const json& request, const json& id);
  void handleCall(const json& request, const json& id);

  CrossNative cn_;
  std::mutex pendingMutex_;
  std::vector<std::thread> pending_;
};

void Host::handleLoad(const json& request, const json& id) {
  const std::string moduleId = request.at("moduleId");
  const std::string language = request.value("language", "wasm");
  const std::string path = request.at("path");

  // loadModule already runs on the pool; wait so ordering is predictable.
  const bool loaded = cn_.loadModule(moduleId, language, path).get();

  json r = ok(id);
  r["success"] = loaded;
  if (loaded) {
    r["functions"] = cn_.getModuleFunctions(moduleId);
  } else {
    r["error"] = "Failed to load module '" + moduleId + "' from " + path;
  }
  respond(r);
}

void Host::handleCall(const json& request, const json& id) {
  const std::string moduleId = request.at("moduleId");
  const std::string function = request.at("function");
  const json args = request.value("args", json::array());

  CallOptions options;
  options.priority =
      static_cast<int>(parsePriority(request.value("priority", "normal")));
  if (request.contains("zeroCopy")) {
    options.zeroCopy = request["zeroCopy"].get<bool>();
  }

  auto future = cn_.callFunction(moduleId, function, args.dump(), options);

  // Answer on a helper thread so stdin keeps being read while the call runs —
  // this is what lets the JS side issue overlapping calls.
  std::lock_guard<std::mutex> lock(pendingMutex_);
  pending_.emplace_back([id, fut = std::move(future)]() mutable {
    respond(toResponse(id, fut.get()));
  });
}

bool Host::dispatch(const json& request, const json& id, const std::string& op) {
  if (op == "ping") {
    json r = ok(id);
    r["result"] = "pong";
    respond(r);
  } else if (op == "load") {
    handleLoad(request, id);
  } else if (op == "call") {
    handleCall(request, id);
  } else if (op == "functions") {
    json r = ok(id);
    r["result"] = cn_.getModuleFunctions(request.at("moduleId"));
    respond(r);
  } else if (op == "unload") {
    cn_.unloadModule(request.at("moduleId"));
    respond(ok(id));
  } else if (op == "stats") {
    json r = ok(id);
    r["result"] = cn_.getStats();
    respond(r);
  } else if (op == "setLogLevel") {
    cn_.setLogLevel(request.value("level", "info"));
    respond(ok(id));
  } else {
    return false;
  }
  return true;
}

void Host::run() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;

    json request;
    try {
      request = json::parse(line);
    } catch (const std::exception& e) {
      respondError(nullptr, std::string("Malformed request: ") + e.what());
      continue;
    }

    const json id = request.value("id", json());
    const std::string op = request.value("op", "");

    try {
      if (!dispatch(request, id, op)) {
        respondError(id, "Unknown op: " + op);
      }
    } catch (const std::exception& e) {
      respondError(id, std::string("Request failed: ") + e.what());
    }
  }

  // stdin closed: drain in-flight calls before tearing down the runtime.
  std::lock_guard<std::mutex> lock(pendingMutex_);
  for (auto& t : pending_) {
    if (t.joinable()) t.join();
  }
}

} // namespace

int main() {
  Host host;
  host.run();
  return 0;
}
