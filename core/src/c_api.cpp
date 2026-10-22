#include "echo/c_api.h"

#include <string>

#include "echo/engine.hpp"

struct EchoCore {
  echo::Engine engine;
  std::string last_response;
};

extern "C" {

EchoCore* echo_create(void) { return new EchoCore(); }

void echo_destroy(EchoCore* core) { delete core; }

const char* echo_call(EchoCore* core, const char* request_json) {
  static const char* kNoCore = "{\"ok\":false,\"error\":{\"code\":\"no_core\",\"message\":\"echo_call on a null core\"}}";
  if (core == nullptr) return kNoCore;
  core->last_response = core->engine.call(request_json != nullptr ? request_json : "");
  return core->last_response.c_str();
}

}  // extern "C"
