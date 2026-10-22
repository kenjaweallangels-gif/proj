// Shared fixtures: a protocol-level harness around echo::Engine with simulated host time.
#pragma once

#include <string>
#include <vector>

#include "echo/engine.hpp"
#include "echo/json.hpp"
#include "echo/state.hpp"

namespace echo::test {

using json::Value;

// D0 data loaded once from the data directory (with the layout subset).
const Value& d0_data();
Value parse_or_die(const std::string& text);

class World {
 public:
  explicit World(double seed = -1, bool with_layout = true);

  Value call(const Value& req);
  Value call_text(const std::string& req);  // raw protocol string
  Value cmd(const char* name) const;

  Value tick(double dt_s = 0.5);
  void run_until(double sim_s);  // ticks without dispatching
  Value dispatch(const std::string& backend = "rules");
  Value rules_propose(const std::string& task_id);
  Value result(const std::string& task_id, const std::string& proposal_text, const std::string& status = "ok") const;
  Value submit(const std::string& task_id, const std::string& proposal_text, const std::string& status = "ok");
  Value submit_result(const Value& result);
  Value decide(const std::string& plan_id, const std::string& decision, const std::string& companion = "");
  Value say(const std::string& npc, const std::string& text);
  Value order(const std::string& npc, const std::string& action, const std::string& target = "", const std::string& companion = "");
  Value patch(const Value& ops);
  Value state(bool debug = false);
  // Dispatches until the request of `actor` comes out; other requests are answered by the rules policy.
  Value dispatch_for(const std::string& actor, const std::string& backend = "rules");
  // Dispatch + rules_propose + submit for everything queued (the ordinary game AI answers all).
  void drain_rules();
  // The CLI scenario loop through the protocol: tick 0.5 s, auto-accept plans, answer requests with rules.
  // Returns every event seen (in order).
  std::vector<Value> run_scenario(double seconds, bool auto_accept = true);

  Core& core() { return engine.core(); }
  Engine engine;
  double now_ms = 0;
};

// Proposal JSON text builder.
std::string intent(const std::string& action, const std::string& target = "", const std::string& companion = "",
                   const std::vector<std::string>& facts = {}, const std::string& style = "concerned");

// Finds the first event of `type` in a response (null when absent).
Value find_event(const Value& response, const std::string& type);
bool has_event(const Value& response, const std::string& type);

}  // namespace echo::test
