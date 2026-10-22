#include <cstring>
#include <string>

#include "data_files.hpp"
#include "echo/c_api.h"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

std::string error_code(const Value& r) { return r["ok"].as_bool() ? "ok" : r["error"]["code"].str(); }

}  // namespace

TEST(protocol, malformed_requests_return_error_codes) {
  echo::Engine fresh;
  auto raw = [&](echo::Engine& e, const std::string& s) { return error_code(parse_or_die(e.call(s))); };
  CHECK_EQ(raw(fresh, "not json"), std::string("bad_json"));
  CHECK_EQ(raw(fresh, ""), std::string("bad_json"));
  CHECK_EQ(raw(fresh, "[]"), std::string("bad_request"));
  CHECK_EQ(raw(fresh, "{}"), std::string("bad_request"));
  CHECK_EQ(raw(fresh, R"({"cmd":1})"), std::string("bad_request"));
  CHECK_EQ(raw(fresh, R"({"cmd":"tick","dt_s":0.5,"now_ms":0})"), std::string("not_initialized"));
  CHECK_EQ(raw(fresh, R"({"cmd":"tick","cmd":"state"})"), std::string("bad_json"));  // duplicate keys
  CHECK_EQ(raw(fresh, R"({"cmd":"version"})"), std::string("ok"));
  World w;
  auto call = [&](const std::string& s) { return error_code(w.call_text(s)); };
  CHECK_EQ(call(R"({"cmd":"nope"})"), std::string("unknown_cmd"));
  CHECK_EQ(call(R"({"cmd":"tick","dt_s":2,"now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"tick","dt_s":-0.1,"now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"tick","dt_s":"0.5","now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"tick","dt_s":0.5})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"player_say","npc_id":"ghost","text":"привет","now_ms":0})"), std::string("not_found"));
  CHECK_EQ(call(R"({"cmd":"player_say","npc_id":"alex","text":"привет","now_ms":0})"), std::string("not_found"));
  CHECK_EQ(call(R"({"cmd":"player_say","npc_id":"mira","text":")" + std::string(601 * 2, 'a').substr(0, 601) + R"(","now_ms":0})"),
           std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"player_order","npc_id":"mira","action":"open_airlock","now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"player_decide","plan_id":"plan-9999","decision":"accept","now_ms":0})"), std::string("not_found"));
  CHECK_EQ(call(R"({"cmd":"player_decide","plan_id":"plan-0001","decision":"maybe","now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"dispatch","backend":"quantum","now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"submit_result","result":{"task_id":"req-000001"},"now_ms":0})"), std::string("invalid_result"));
  CHECK_EQ(call(R"({"cmd":"submit_result","result":{"task_id":"req-000001","status":"ok","proposal_text":null,"usage":{"input_tokens":1,"output_tokens":1,"measured":true},"latency_ms":{"total":1},"provider":"p","model":"m","finish_reason":"stop","attempts":1,"secret":1},"now_ms":0})"),
           std::string("invalid_result"));
  CHECK_EQ(call(R"({"cmd":"frame_stats","samples":[{"interval_ms":-1,"cpu_ms":1,"gpu_ms":null}],"now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"frame_stats","samples":[{"interval_ms":16,"cpu_ms":1,"gpu_ms":"x"}],"now_ms":0})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"set_ai_mode","mode":"turbo","gpu_enabled":true,"calibrated":true,"privacy_profile":"offline"})"),
           std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"rules_propose","task_id":"req-424242"})"), std::string("not_found"));
  CHECK_EQ(call(R"({"cmd":"memory","npc_id":"ghost"})"), std::string("not_found"));
  CHECK_EQ(call(R"({"cmd":"load","save":{"format":"other"}})"), std::string("bad_save"));
  CHECK_EQ(call(R"({"cmd":"debug_patch","patch":[{"op":"teleport"}]})"), std::string("invalid_argument"));
  CHECK_EQ(call(R"({"cmd":"init","data":{"world":{}}})"), std::string("data_invalid"));
  // A failed init does not destroy the running world.
  CHECK_EQ(call(R"({"cmd":"state"})"), std::string("ok"));
}

TEST(protocol, c_api_roundtrip) {
  EchoCore* core = echo_create();
  REQUIRE(core != nullptr);
  const char* v = echo_call(core, R"({"cmd":"version"})");
  CHECK(std::strstr(v, "zero-echo.prompt.ru.v1") != nullptr);
  CHECK(std::strstr(echo_call(core, nullptr), "bad_json") != nullptr);
  const std::string init = echo::json::dump(echo::host::init_request(d0_data()));
  const Value r = parse_or_die(echo_call(core, init.c_str()));
  CHECK(r["ok"].as_bool());
  CHECK_EQ(r["summary"]["npcs"].as_int(), 6);
  const char* tick = echo_call(core, R"({"cmd":"tick","dt_s":1.0,"now_ms":1000})");
  CHECK(std::strstr(tick, "\"ok\":true") != nullptr);
  echo_destroy(core);
  CHECK(std::strstr(echo_call(nullptr, "{}"), "no_core") != nullptr);
}

TEST(protocol, events_memory_and_peek_commands) {
  World w;
  w.run_scenario(60);
  Value e = w.cmd("events");
  e.set("since_seq", 5);
  const Value ev = w.call(e);
  REQUIRE(ev["events"].size() > 0);
  CHECK_EQ(ev["events"].at(0)["seq"].as_int(), 6);
  for (const auto& x : ev["events"].items()) {
    CHECK(!x["text_ru"].str().empty());
    const std::string src = x["source"].str();
    CHECK(src == "sim" || src == "player" || src == "agent_accepted" || src == "director" || src == "fallback");
  }
  Value m = w.cmd("memory");
  m.set("npc_id", "mira");
  const Value mem = w.call(m);
  CHECK(mem["entries"].size() > 3);
  bool fact_with_source = false;
  for (const auto& k : mem["known_facts"].items()) fact_with_source = fact_with_source || k["source"].str() == "event:hist_1";
  CHECK(fact_with_source);
  w.say("nika", "Ника, привет");
  const Value d = w.dispatch("rules");
  Value p = w.cmd("peek_request");
  p.set("task_id", d["request"]["task_id"].str());
  CHECK_EQ(w.call(p)["request"]["actor_id"].str(), std::string("nika"));
}

TEST(protocol, debug_patch_ops_bump_revision) {
  World w;
  const auto rev0 = w.core().st.revision;
  Value ops = Value::array();
  auto add = [&](std::initializer_list<std::pair<const char*, Value>> kv) {
    Value o = Value::object();
    for (const auto& [k, v] : kv) o.set(k, v);
    ops.push(o);
  };
  add({{"op", "set_actor_busy"}, {"actor", "yun"}, {"busy", true}});
  add({{"op", "set_resource"}, {"id", "water_l"}, {"amount", 800}});
  add({{"op", "set_door"}, {"id", "d_ws_sector_c"}, {"state", "sealed"}});
  add({{"op", "move_actor"}, {"actor", "samir"}, {"zone", "hab_main"}});
  add({{"op", "set_sensor_reading"}, {"id", "sensor_b"}, {"value", 99.0}, {"trend", "falling"}});
  add({{"op", "bump_revision"}, {"entity", "sensor_a"}});
  const Value r = w.patch(ops);
  REQUIRE(r["ok"].as_bool());
  CHECK(w.core().st.revision >= rev0 + 6);
  const Value s = w.state(true);
  bool sealed = false;
  for (const auto& z : s["zones"].items()) sealed = sealed || (z["id"].str() == "sector_c" && z["sealed"].as_bool());
  CHECK(sealed);
  for (const auto& sen : s["sensors"].items()) {
    if (sen["id"].str() == "sensor_b") {
      CHECK_EQ(sen["reading"]["value"].as_number(), 99.0);
      CHECK_EQ(sen["truth"]["value"].as_number(), 101.3);  // instrument changed, truth did not
    }
  }
}

TEST(protocol, snapshot_shape_matches_spec) {
  World w;
  w.run_scenario(30);
  const Value s = w.state();
  for (const char* k : {"sim_time_s", "revision", "hash", "resources", "zones", "doors", "sensors", "actors", "tasks", "plans",
                        "queue", "director", "biography", "emergency_lights", "gate"}) {
    CHECK_MSG(s.has(k), k);
  }
  for (const auto& a : s["actors"].items()) {
    for (const char* k : {"id", "name_ru", "zone", "activity", "fatigue", "trust_player", "gesture", "style", "busy"}) CHECK_MSG(a.has(k), k);
    const std::string act = a["activity"].str();
    CHECK(act == "idle" || act == "walking" || act == "working" || act == "resting" || act == "talking");
  }
  for (const auto& sen : s["sensors"].items()) CHECK(!sen.has("truth"));  // physical truth only in debug
  CHECK(s["emergency_lights"].as_bool());
  CHECK(s["director"].has("tension"));
  CHECK(s["gate"].has("gpu_allowed"));
  CHECK(echo::starts_with(s["hash"].str(), "fnv1a64:"));
}
