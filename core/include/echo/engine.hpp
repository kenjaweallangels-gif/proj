// Echo Runtime core — C++ API. One entry point, the JSON command protocol of docs/SPEC.md §1, shared by the
// native CLI, the WebAssembly module and the tests: call() takes a request {"cmd": ..., ...} and returns
// {"ok": true, ...} or {"ok": false, "error": {"code", "message"}}.
#pragma once

#include <memory>
#include <string>
#include <string_view>

#include "echo/json.hpp"
#include "echo/state.hpp"

namespace echo {

inline constexpr std::size_t kMaxRequestBytes = 8u * 1024u * 1024u;

class Engine {
 public:
  Engine();
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  // Raw protocol: UTF-8 JSON in, UTF-8 JSON out.
  std::string call(std::string_view request_json);
  // Same protocol on parsed values (in-process hosts and tests).
  json::Value call_json(const json::Value& request);

  bool initialized() const { return core_ != nullptr; }
  Core& core() { return *core_; }
  const Core& core() const { return *core_; }

 private:
  std::unique_ptr<Core> core_;
};

json::Value error_response(const std::string& code, const std::string& message);

}  // namespace echo
