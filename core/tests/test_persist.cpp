#include <string>

#include "echo/persist.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

Value save_of(World& w) { return w.call(w.cmd("save"))["save"]; }

Value load_into(World& w, const Value& save) {
  Value l = w.cmd("load");
  l.set("save", save);
  return w.call(l);
}

}  // namespace

TEST(persist, save_load_reproduces_hash_and_future) {
  World a;
  a.run_scenario(150);  // mid-repair: tasks, plans, memory, director state, biography in flight
  const Value save = save_of(a);
  const std::string hash = a.state()["hash"].str();
  CHECK_EQ(save["hash"].str(), hash);
  World b;
  const Value r = load_into(b, save);
  REQUIRE(r["ok"].as_bool());
  CHECK_EQ(r["hash"].str(), hash);
  CHECK_EQ(b.state()["hash"].str(), hash);
  b.now_ms = a.now_ms;
  // Both continue identically: the save holds everything that determines the future (rng, queue, tasks).
  a.run_scenario(200);
  b.run_scenario(200);
  CHECK_EQ(a.state()["hash"].str(), b.state()["hash"].str());
}

TEST(persist, same_seed_same_commands_same_hash) {
  World a(1234), b(1234), c(99);
  a.run_scenario(400);
  b.run_scenario(400);
  c.run_scenario(400);
  CHECK_EQ(a.state()["hash"].str(), b.state()["hash"].str());
  CHECK(a.core().st.seed != c.core().st.seed);
  // Re-saving a loaded state is byte-stable.
  World d;
  REQUIRE(load_into(d, save_of(a))["ok"].as_bool());
  CHECK_EQ(echo::json::dump_canonical(save_of(d)["state"]), echo::json::dump_canonical(save_of(a)["state"]));
}

TEST(persist, load_rejects_other_data_and_tampering) {
  World a;
  a.run_scenario(60);
  Value save = save_of(a);
  {
    Value tampered = save;
    Value& st = *tampered.find_mut("state");
    st.find_mut("resources")->find_mut("oxygen_kg")->set("amount", 9999);
    World b;
    const Value r = load_into(b, tampered);
    CHECK_EQ(r["error"]["code"].str(), std::string("hash_mismatch"));
  }
  {
    Value data = d0_data();
    data.find_mut("world")->set("title_ru", "другой мир");
    echo::Engine e;
    Value init = Value::object();
    init.set("cmd", "init");
    init.set("data", data);
    REQUIRE(parse_or_die(e.call(echo::json::dump(init)))["ok"].as_bool());
    Value l = Value::object();
    l.set("cmd", "load");
    l.set("save", save);
    CHECK_EQ(parse_or_die(e.call(echo::json::dump(l)))["error"]["code"].str(), std::string("data_mismatch"));
  }
  {
    World b;
    Value broken = save;
    broken.find_mut("state")->erase("actors");
    broken.erase("hash");
    CHECK_EQ(load_into(b, broken)["error"]["code"].str(), std::string("bad_save"));
  }
}

TEST(persist, save_contains_versions_log_memory_and_accepted_intents) {
  World a;
  a.run_scenario(200);
  const Value s = save_of(a);
  CHECK_EQ(s["format"].str(), std::string("zero-echo.save.v1"));
  CHECK_EQ(s["versions"]["prompt_version"].str(), std::string("zero-echo.prompt.ru.v1"));
  CHECK_EQ(s["versions"]["intent_schema_version"].str(), std::string("zero-echo.intent.v1"));
  CHECK_EQ(s["kv_cache_included"].as_bool(), false);
  CHECK(s["seed"].is_number());
  const Value& st = s["state"];
  CHECK(st["events"].size() > 20);
  CHECK(st["accepted_intents"].size() > 0);
  for (const auto& a2 : st["accepted_intents"].items()) CHECK(!a2["proposal_text"].str().empty());
  for (const auto& e : st["memory"]["mira"]["entries"].items()) CHECK(!e["source"].str().empty());
  bool opinion_with_confidence = false;
  for (const auto& e : st["memory"]["mira"]["entries"].items()) {
    opinion_with_confidence = opinion_with_confidence || (e["kind"].str() == "opinion" && e["confidence"].as_number() > 0);
  }
  CHECK(opinion_with_confidence);
  CHECK(!st["rng"].str().empty());
}
