#include <string>
#include <vector>

#include "echo/director.hpp"
#include "echo/engine.hpp"
#include "echo/world.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

const echo::DirectorEventDef& event_def(World& w, const std::string& id) {
  for (const auto& e : w.core().data.director.events) {
    if (e.id == id) return e;
  }
  return w.core().data.director.events.front();
}

std::string check(World& w, const std::string& id, std::string* witness = nullptr) {
  std::string wit;
  const std::string r = echo::director_check(w.core(), event_def(w, id), wit);
  if (witness != nullptr) *witness = wit;
  return r;
}

Value init_with(Value data) {
  echo::Engine e;
  Value init = Value::object();
  init.set("cmd", "init");
  init.set("data", data);
  return parse_or_die(e.call(echo::json::dump(init)));
}

}  // namespace

TEST(director, never_touches_physical_layer) {
  World w;
  const auto events = w.run_scenario(1800);
  int director_events = 0;
  double consumed_sealant = 0, consumed_seals = 0;
  for (const auto& e : events) {
    if (e["type"].str() == "director_event") {
      ++director_events;
      for (const auto& ef : e["payload"]["effects"].items()) {
        const std::string t = ef["type"].str();
        CHECK(t == "sound" || t == "instrument_distortion" || t == "interpretation");
      }
    }
    if (e["source"].str() == "director") CHECK(e["type"].str().rfind("director_", 0) == 0 || e["type"].str() == "speech");
    if (e["type"].str() == "resource_consumed") {
      CHECK(e["source"].str() == "sim");  // only finished tasks spend resources
      if (e["payload"]["resource"].str() == "sealant") consumed_sealant += e["payload"]["amount"].as_number();
      if (e["payload"]["resource"].str() == "spare_seals") consumed_seals += e["payload"]["amount"].as_number();
    }
  }
  CHECK(director_events >= 3);
  const auto& st = w.core().st;
  for (const auto& s : w.core().data.sensors) {
    CHECK_EQ(st.sensors.at(s.id).truth.value, s.truth.value);  // physical truth never changes
  }
  CHECK_EQ(st.resources.at("sealant").amount, 3.0 - consumed_sealant);
  CHECK_EQ(st.resources.at("spare_seals").amount, 4.0 - consumed_seals);
  CHECK_EQ(st.resources.at("oxygen_kg").amount, 420.0);
  for (const auto& [actor, mem] : st.memory) {
    for (const auto& k : mem.facts) {
      if (k.source.find("sound") != std::string::npos) CHECK_EQ(w.core().data.fact(k.fact)->layer, std::string("interpretation"));
    }
  }
  CHECK_EQ(w.core().rt.ai.violations_admitted, 0u);
}

TEST(director, echo_event_preconditions_exact) {
  World w;
  w.run_until(70);  // story window opened at 60 s; the pressure alarm is still on
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("emergency"));
  w.core().st.emergency = false;
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("tension"));  // still too tense after the alarm
  // Mira's waiting plan soft-reserves Nika as her companion: a reserved witness is not idle.
  std::vector<std::string> waiting;
  for (const auto& [id, p] : w.core().st.plans) {
    if (p.state == "awaiting_player") waiting.push_back(id);
  }
  w.core().st.director.tension = 0.1;
  if (!waiting.empty()) CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("no_witness"));
  for (const auto& id : waiting) w.decide(id, "reject");
  w.core().st.director.tension = 0.1;
  std::string witness;
  CHECK_EQ(check(w, "echo_phrase_sector_c", &witness), std::string(""));
  CHECK_EQ(witness, std::string("nika"));
  // The last echo must be long enough ago.
  const auto saved_echo = w.core().st.director.last_echo_ms;
  w.core().st.director.last_echo_ms = w.core().st.sim_ms - 1000;
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("echo_too_recent"));
  w.core().st.director.last_echo_ms = saved_echo;
  // The witness must be near the sector and idle.
  Value busy = Value::array();
  Value b = Value::object();
  b.set("op", "set_actor_busy");
  b.set("actor", "nika");
  b.set("busy", true);
  busy.push(b);
  w.patch(busy);
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("no_witness"));
  b.set("busy", false);
  Value unbusy = Value::array();
  unbusy.push(b);
  w.patch(unbusy);
  Value move = Value::array();
  Value m = Value::object();
  m.set("op", "move_actor");
  m.set("actor", "nika");
  m.set("zone", "medbay");
  move.push(m);
  w.patch(move);
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("no_witness"));
  m.set("zone", "workshop");
  Value back = Value::array();
  back.push(m);
  w.patch(back);
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string(""));
  // No emergency task nearby (an isolation job in the workshop's neighbour blocks it).
  w.order("mira", "prepare_isolation", "sector_c");
  const Value req = w.dispatch_for("mira");
  w.submit(req["task_id"].str(), w.rules_propose(req["task_id"].str())["proposal_text"].str());
  CHECK_EQ(check(w, "echo_phrase_sector_c"), std::string("emergency_task_near"));
  // The calm window after an emergency.
  World calm;
  calm.run_until(70);
  calm.core().st.emergency = false;
  echo::director_on_emergency_end(calm.core());
  CHECK_EQ(check(calm, "echo_phrase_sector_c"), std::string("calm_window"));
  // Too early in the story.
  World early;
  early.run_until(10);
  CHECK_EQ(check(early, "echo_phrase_sector_c"), std::string("story_window"));
  // The player must already know the phrase.
  Value data = d0_data();
  Value& alex = *data.find_mut("world")->find_mut("initial_knowledge")->find_mut("alex");
  Value kept = Value::array();
  for (const auto& k : alex.items()) {
    if (k["fact"].str() != "echo_phrase_known") kept.push(k);
  }
  alex = kept;
  echo::Engine e;
  Value init = Value::object();
  init.set("cmd", "init");
  init.set("data", data);
  REQUIRE(parse_or_die(e.call(echo::json::dump(init)))["ok"].as_bool());
  e.core().st.sim_ms = 70000;
  std::string wit;
  for (const auto& ev : e.core().data.director.events) {
    if (ev.id == "echo_phrase_sector_c") CHECK_EQ(echo::director_check(e.core(), ev, wit), std::string("player_lacks:echo_phrase_known"));
  }
}

TEST(director, tension_decay_calm_window_and_pacing) {
  World w;
  const double initial = w.core().st.director.tension;
  w.run_until(19);
  CHECK(w.core().st.director.tension < initial);  // decays
  w.run_until(21);
  CHECK(w.core().st.director.tension > 0.59);  // the alarm raised it to 0.6 a second ago
  const auto events = w.run_scenario(600);
  std::int64_t repaired_ms = -1, last_ms = -1;
  for (const auto& e : events) {
    const auto t = static_cast<std::int64_t>(e["t"].as_number() * 1000);
    if (e["type"].str() == "sensor_repaired") repaired_ms = t;
    if (e["type"].str() == "director_event") {
      CHECK(repaired_ms >= 0);                // nothing during the emergency
      CHECK(t - repaired_ms >= 90000);        // calm window
      if (last_ms >= 0) CHECK(t - last_ms >= 75000);  // minimum gap between events
      last_ms = t;
    }
  }
  CHECK(last_ms > 0);
}

TEST(director, data_validation_rejects_forbidden_capabilities) {
  {
    Value data = d0_data();
    Value& events = *data.find_mut("director")->find_mut("events");
    Value& effects = *events.items_mut()[1].find_mut("effects");
    Value bad = Value::object();
    bad.set("type", "resource_change");
    effects.push(bad);
    const Value r = init_with(data);
    CHECK_EQ(r["error"]["code"].str(), std::string("data_invalid"));
  }
  {
    Value data = d0_data();
    Value& allowed = *data.find_mut("director")->find_mut("allowed_effect_types");
    allowed.push("oxygen_leak");
    CHECK_EQ(init_with(data)["error"]["code"].str(), std::string("data_invalid"));
  }
  {
    Value data = d0_data();  // an interpretation may not hand out a physical fact
    Value& events = *data.find_mut("director")->find_mut("events");
    for (auto& ef : events.items_mut()[0].find_mut("effects")->items_mut()) {
      if (ef["type"].str() == "interpretation") ef.set("fact", "sensor_a_drift_confirmed");
    }
    const Value r = init_with(data);
    CHECK_EQ(r["error"]["code"].str(), std::string("data_invalid"));
    CHECK(r["error"]["message"].str().find("interpretation") != std::string::npos);
  }
}

TEST(director, deterministic_with_seed) {
  World a, b;
  a.run_scenario(900);
  b.run_scenario(900);
  CHECK(a.core().st.director.fired == b.core().st.director.fired);
  CHECK(!a.core().st.director.fired.empty());
}

TEST(director, heard_sound_becomes_checked_fact_only_after_inspection) {
  World w;
  const auto events = w.run_scenario(420);
  bool fired = false, survey_done = false;
  for (const auto& e : events) {
    if (e["type"].str() == "director_event" && e["payload"]["event"].str() == "echo_phrase_sector_c") fired = true;
    if (e["type"].str() == "task_completed" && e["payload"]["target"].str() == "sector_c") {
      CHECK(fired);
      survey_done = true;
    }
  }
  REQUIRE(fired);
  const echo::KnownFact* heard = echo::known_fact(w.core(), "nika", "sound_heard_sector_c");
  REQUIRE(heard != nullptr);
  CHECK_EQ(heard->source, std::string("observation:sound_sector_c"));
  CHECK_EQ(w.core().data.fact("sound_heard_sector_c")->layer, std::string("interpretation"));
  if (survey_done) {
    const echo::KnownFact* checked = echo::known_fact(w.core(), "nika", "sector_c_checked_empty");
    REQUIRE(checked != nullptr);
    CHECK_EQ(checked->source, std::string("observation:sector_c"));
    bool episode = false;
    for (const auto& m : w.core().st.memory.at("nika").entries) episode = episode || m.text_ru.find("Проверено на месте") != std::string::npos;
    CHECK(episode);
  } else {
    // Before the survey the only record is an interpretation with a confidence, not a checked fact.
    CHECK_EQ(echo::known_fact(w.core(), "nika", "sector_c_checked_empty")->source, std::string("event:hist_2"));
  }
}
