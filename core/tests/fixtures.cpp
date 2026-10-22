#include "fixtures.hpp"

#include <cstdio>
#include <cstdlib>

#include "data_files.hpp"
#include "harness.hpp"

namespace echo::test {

const Value& d0_data() {
  static Value data;
  static bool loaded = false;
  if (!loaded) {
    std::string error;
    if (!host::load_data_dir(data_dir(), data, error)) {
      std::printf("Не удалось загрузить данные D0: %s\n", error.c_str());
      std::exit(2);
    }
    loaded = true;
  }
  return data;
}

Value parse_or_die(const std::string& text) {
  Value v;
  json::ParseError err;
  if (!json::parse(text, v, &err)) {
    std::printf("неверный JSON от ядра: %s\n", err.message.c_str());
    std::exit(3);
  }
  return v;
}

World::World(double seed, bool with_layout) {
  Value data = d0_data();
  if (!with_layout) data.erase("layout");
  const Value r = call(host::init_request(data, seed));
  if (!r["ok"].as_bool()) {
    std::printf("init не удался: %s\n", json::dump(r).c_str());
    std::exit(2);
  }
}

Value World::call(const Value& req) { return parse_or_die(engine.call(json::dump(req))); }
Value World::call_text(const std::string& req) { return parse_or_die(engine.call(req)); }

Value World::cmd(const char* name) const {
  Value v = Value::object();
  v.set("cmd", name);
  return v;
}

Value World::tick(double dt_s) {
  now_ms += dt_s * 1000.0;
  Value t = cmd("tick");
  t.set("dt_s", dt_s);
  t.set("now_ms", now_ms);
  return call(t);
}

void World::run_until(double sim_s) {
  while (core().st.sim_ms < static_cast<std::int64_t>(sim_s * 1000.0 + 0.5)) tick(0.5);
}

Value World::dispatch(const std::string& backend) {
  Value d = cmd("dispatch");
  d.set("now_ms", now_ms);
  d.set("backend", backend);
  return call(d);
}

Value World::rules_propose(const std::string& task_id) {
  Value r = cmd("rules_propose");
  r.set("task_id", task_id);
  return call(r);
}

Value World::result(const std::string& task_id, const std::string& proposal_text, const std::string& status) const {
  Value r = Value::object();
  r.set("task_id", task_id);
  r.set("status", status);
  r.set("proposal_text", status == "ok" ? Value(proposal_text) : Value());
  Value usage = Value::object();
  usage.set("input_tokens", 900);
  usage.set("output_tokens", 40);
  usage.set("measured", true);
  r.set("usage", usage);
  Value lat = Value::object();
  lat.set("total", 800);
  lat.set("first_token", 250);
  r.set("latency_ms", lat);
  r.set("provider", "test");
  r.set("model", "fixture-model");
  r.set("finish_reason", "stop");
  r.set("attempts", 1);
  return r;
}

Value World::submit(const std::string& task_id, const std::string& proposal_text, const std::string& status) {
  return submit_result(result(task_id, proposal_text, status));
}

Value World::submit_result(const Value& res) {
  Value s = cmd("submit_result");
  s.set("result", res);
  s.set("now_ms", now_ms);
  return call(s);
}

Value World::decide(const std::string& plan_id, const std::string& decision, const std::string& companion) {
  Value d = cmd("player_decide");
  d.set("plan_id", plan_id);
  d.set("decision", decision);
  if (!companion.empty()) d.set("companion_id", companion);
  d.set("now_ms", now_ms);
  return call(d);
}

Value World::say(const std::string& npc, const std::string& text) {
  Value s = cmd("player_say");
  s.set("npc_id", npc);
  s.set("text", text);
  s.set("now_ms", now_ms);
  return call(s);
}

Value World::order(const std::string& npc, const std::string& action, const std::string& target, const std::string& companion) {
  Value o = cmd("player_order");
  o.set("npc_id", npc);
  o.set("action", action);
  if (!target.empty()) o.set("target_id", target);
  if (!companion.empty()) o.set("companion_id", companion);
  o.set("now_ms", now_ms);
  return call(o);
}

Value World::patch(const Value& ops) {
  Value p = cmd("debug_patch");
  p.set("patch", ops);
  p.set("now_ms", now_ms);
  return call(p);
}

Value World::state(bool debug) {
  Value s = cmd("state");
  s.set("debug", debug);
  s.set("now_ms", now_ms);
  return call(s);
}

Value World::dispatch_for(const std::string& actor, const std::string& backend) {
  for (int guard = 0; guard < 16; ++guard) {
    const Value d = dispatch(backend);
    if (d["request"].is_null()) return Value();
    if (d["request"]["actor_id"].str() == actor) return d["request"];
    const std::string id = d["request"]["task_id"].str();
    submit(id, rules_propose(id)["proposal_text"].str());
  }
  return Value();
}

void World::drain_rules() {
  for (int guard = 0; guard < 32; ++guard) {
    const Value d = dispatch("rules");
    if (d["request"].is_null()) return;
    const std::string id = d["request"]["task_id"].str();
    submit(id, rules_propose(id)["proposal_text"].str());
  }
}

std::vector<Value> World::run_scenario(double seconds, bool auto_accept) {
  std::vector<Value> seen;
  std::vector<std::string> plans;
  auto absorb = [&](const Value& r) {
    for (const auto& e : r["events"].items()) {
      seen.push_back(e);
      if (e["type"].str() == "plan_created") plans.push_back(e["payload"]["plan_id"].str());
    }
  };
  auto accept_all = [&]() {
    while (auto_accept && !plans.empty()) {
      const std::string p = plans.front();
      plans.erase(plans.begin());
      absorb(decide(p, "accept"));
    }
    if (!auto_accept) plans.clear();
  };
  const long long steps = static_cast<long long>(seconds / 0.5 + 0.5);
  for (long long i = 0; i < steps; ++i) {
    absorb(tick(0.5));
    accept_all();
    for (int guard = 0; guard < 16; ++guard) {
      const Value d = dispatch("rules");
      absorb(d);
      if (d["request"].is_null()) break;
      const std::string id = d["request"]["task_id"].str();
      absorb(submit(id, rules_propose(id)["proposal_text"].str()));
      accept_all();
    }
  }
  return seen;
}

std::string intent(const std::string& action, const std::string& target, const std::string& companion,
                   const std::vector<std::string>& facts, const std::string& style) {
  Value v = Value::object();
  v.set("action", action);
  v.set("target_id", target.empty() ? Value() : Value(target));
  v.set("companion_id", companion.empty() ? Value() : Value(companion));
  v.set("fact_ids", Value::string_array(facts));
  v.set("style", style);
  return json::dump(v);
}

Value find_event(const Value& response, const std::string& type) {
  for (const auto& e : response["events"].items()) {
    if (e["type"].str() == type) return e;
  }
  return Value();
}

bool has_event(const Value& response, const std::string& type) { return !find_event(response, type).is_null(); }

}  // namespace echo::test
