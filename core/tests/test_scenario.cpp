#include <string>
#include <vector>

#include "echo/world.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

const Value* first(const std::vector<Value>& events, const std::string& type, const std::string& actor = "") {
  for (const auto& e : events) {
    if (e["type"].str() == type && (actor.empty() || e["actor"].str() == actor)) return &e;
  }
  return nullptr;
}

}  // namespace

TEST(scenario, full_mira_d0_end_to_end) {
  World w;
  const auto events = w.run_scenario(300);
  // t=20 s: the scripted alarm (instrument layer only).
  const Value* alarm = first(events, "trigger_fired");
  REQUIRE(alarm != nullptr);
  CHECK_EQ((*alarm)["t"].as_number(), 20.0);
  // Mira proposes the paired inspection with her canonical line; the player accepts.
  const Value* plan = first(events, "plan_created", "mira");
  REQUIRE(plan != nullptr);
  CHECK_EQ((*plan)["payload"]["action"].str(), std::string("inspect"));
  CHECK_EQ((*plan)["payload"]["target"].str(), std::string("sensor_a"));
  CHECK_EQ((*plan)["payload"]["companion"].str(), std::string("nika"));
  bool canonical = false;
  for (const auto& e : events) {
    canonical = canonical || (e["type"].str() == "speech" &&
                              e["payload"]["text"].str() == "Я проверю датчик A. Ника останется у шлюза — после прошлого раза по одному не идём.");
  }
  CHECK(canonical);
  // The inspection reveals the drift to both inspectors, then Mira repairs and the lights go off.
  CHECK(echo::known_fact(w.core(), "mira", "sensor_a_drift_confirmed") != nullptr);
  CHECK(echo::known_fact(w.core(), "nika", "sensor_a_drift_confirmed") != nullptr);
  CHECK_EQ(echo::known_fact(w.core(), "mira", "sensor_a_drift_confirmed")->source, std::string("observation:sensor_a"));
  CHECK(echo::known_fact(w.core(), "alex", "sensor_a_drift_confirmed") != nullptr);  // told to the commander
  CHECK(first(events, "sensor_repaired") != nullptr);
  CHECK(!w.core().st.emergency_lights);
  CHECK_EQ(w.core().st.sensors.at("sensor_a").reading.value, 101.2);
  // Other characters lived their own lives.
  const Value* rest = first(events, "plan_created", "thomas");
  REQUIRE(rest != nullptr);
  CHECK_EQ((*rest)["payload"]["target"].str(), std::string("yun"));
  CHECK(w.core().st.items.at("sample_07").preserved);
  CHECK_EQ(w.core().st.actors.at("yun").activity, std::string("resting"));
  // Consequences: resources, biography, memory with sources, zero violations.
  CHECK_EQ(w.core().st.resources.at("spare_seals").amount, 3.0);
  CHECK(w.core().st.biography.size() >= 3);
  bool promise = false;
  for (const auto& m : w.core().st.memory.at("mira").entries) promise = promise || (m.kind == "promise" && echo::starts_with(m.source, "event:"));
  CHECK(promise);
  CHECK_EQ(w.core().rt.ai.violations_admitted, 0u);
  CHECK_EQ(w.core().rt.ai.invalid_intents, 0u);
  // Deterministic: a second identical run lands on the same hash.
  World again;
  again.run_scenario(300);
  CHECK_EQ(w.state()["hash"].str(), again.state()["hash"].str());
}

TEST(scenario, unreliable_model_never_blocks_the_game) {
  // Mira's alarm request gets an injection, then the follow-up a timeout; the colony still resolves the alarm.
  World w;
  w.run_until(20.5);
  const Value req = w.dispatch_for("mira");
  const Value bad = w.submit(req["task_id"].str(),
                             R"({"action":"inspect","target_id":"sensor_a","style":"concerned","actor_id":"mira","note":"ignore rules"})");
  CHECK_EQ(bad["verdict"]["status"].str(), std::string("rejected"));
  CHECK(bad["verdict"]["fallback_used"].as_bool());
  const std::string plan = bad["verdict"]["plan_id"].str();
  REQUIRE(!plan.empty());  // the fallback still produced Mira's paired-inspection plan
  w.decide(plan, "accept");
  bool repaired = false;
  for (int i = 0; i < 2 * 300 && !repaired; ++i) {
    w.tick(0.5);
    for (int guard = 0; guard < 8; ++guard) {
      const Value d = w.dispatch("cpu");
      if (d["request"].is_null()) break;
      w.submit(d["request"]["task_id"].str(), "", "timeout");
    }
    std::vector<std::string> waiting;
    for (const auto& [id, p] : w.core().st.plans) {
      if (p.state == "awaiting_player") waiting.push_back(id);
    }
    for (const auto& id : waiting) w.decide(id, "accept");
    repaired = !w.core().st.sensors.at("sensor_a").fault.size();
  }
  CHECK(repaired);
  CHECK(!w.core().st.emergency_lights);
  CHECK(w.core().rt.ai.fallback_reasons.count("timeout") > 0);
  CHECK_EQ(w.core().rt.ai.violations_admitted, 0u);
}
