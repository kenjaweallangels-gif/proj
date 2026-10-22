#include <string>
#include <vector>

#include "data_files.hpp"
#include "echo/authority.hpp"
#include "echo/context.hpp"
#include "echo/util.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

Value op(const char* name) {
  Value v = Value::object();
  v.set("op", name);
  return v;
}

Value ops(std::initializer_list<Value> items) {
  Value a = Value::array();
  for (const auto& i : items) a.push(i);
  return a;
}

Value busy(const char* actor, bool b = true) {
  Value v = op("set_actor_busy");
  v.set("actor", actor);
  v.set("busy", b);
  return v;
}

double resource(World& w, const char* id, const char* field) {
  const Value st = w.state();
  for (const auto& r : st["resources"].items()) {
    if (r["id"].str() == id) return r[field].as_number();
  }
  return -1;
}

const Value* plan_of(const Value& state, const std::string& plan_id) {
  for (const auto& p : state["plans"].items()) {
    if (p["plan_id"].str() == plan_id) return &p;
  }
  return nullptr;
}

std::string plan_state(World& w, const std::string& plan_id) {
  const Value s = w.state();
  const Value* p = plan_of(s, plan_id);
  return p != nullptr ? (*p)["state"].str() : "";
}

const echo::Task* task_of(World& w, const std::string& id) {
  const auto it = w.core().st.tasks.find(id);
  return it == w.core().st.tasks.end() ? nullptr : &it->second;
}

bool reasons_have(const Value& verdict, const std::string& prefix) {
  for (const auto& r : verdict["reasons"].items()) {
    if (echo::starts_with(r.str(), prefix)) return true;
  }
  return false;
}

// Mira's alarm request dispatched at t ≈ 20.5 s.
struct Alarm {
  World w;
  Value req;
  std::string id;
  Alarm() {
    w.run_until(20.5);
    req = w.dispatch_for("mira");
    id = req["task_id"].str();
  }
};

}  // namespace

TEST(authority, accepted_plan_has_seven_step_trace) {
  Alarm a;
  REQUIRE(!a.req.is_null());
  const Value r = a.w.submit(a.id, intent("inspect", "sensor_a", "nika", {"pressure_disagreement"}));
  const Value& v = r["verdict"];
  CHECK_EQ(v["status"].str(), std::string("awaiting_player"));
  CHECK_EQ(v["actor"].str(), std::string("mira"));
  CHECK_EQ(v["steps"].size(), static_cast<std::size_t>(7));
  for (std::size_t i = 0; i < 7; ++i) {
    CHECK_EQ(v["steps"].at(i)["step"].as_int(), static_cast<long long>(i + 1));
  }
  CHECK(!v["plan_id"].is_null());
  CHECK(!v["fallback_used"].as_bool());
  CHECK_EQ(r["speech"]["kind"].str(), std::string("line"));
}

TEST(authority, expired_deadline_falls_back) {
  Alarm a;
  a.w.now_ms += 4500;  // initiative deadline is 4000 ms after the alarm
  const Value r = a.w.submit(a.id, intent("inspect", "sensor_a", "nika"));
  CHECK_EQ(r["verdict"]["status"].str(), std::string("expired"));
  CHECK(r["verdict"]["fallback_used"].as_bool());
  CHECK_EQ(r["verdict"]["fallback_reason"].str(), std::string("deadline"));
  CHECK_EQ(r["speech"]["kind"].str(), std::string("fallback"));
  // A second late delivery does not apply anything again.
  const Value again = a.w.submit(a.id, intent("inspect", "sensor_a", "nika"));
  CHECK_EQ(again["verdict"]["status"].str(), std::string("expired"));
  CHECK(!again["verdict"]["fallback_used"].as_bool());
}

TEST(authority, duplicate_delivery_no_double_spend) {
  Alarm a;
  const std::string text = intent("repair", "sensor_a", "", {"sensor_a_drop"});
  const Value first = a.w.submit(a.id, text);
  REQUIRE(first["verdict"]["status"].str() == "accepted");
  CHECK_EQ(resource(a.w, "spare_seals", "reserved"), 1.0);
  CHECK_EQ(resource(a.w, "spare_seals", "amount"), 4.0);
  const Value dup = a.w.submit(a.id, text);
  CHECK_EQ(dup["verdict"]["status"].str(), std::string("duplicate"));
  CHECK(dup["speech"].is_null());
  CHECK_EQ(resource(a.w, "spare_seals", "reserved"), 1.0);
  a.w.run_until(240);
  CHECK_EQ(resource(a.w, "spare_seals", "amount"), 3.0);
  CHECK_EQ(resource(a.w, "spare_seals", "reserved"), 0.0);
  CHECK_EQ(a.w.core().rt.ai.violations_admitted, 0u);
}

TEST(authority, stale_only_when_dependency_changed) {
  {
    Alarm a;
    a.w.patch(ops({busy("nika")}));  // the proposed companion changed after the request was built
    const Value r = a.w.submit(a.id, intent("inspect", "sensor_a", "nika"));
    CHECK_EQ(r["verdict"]["status"].str(), std::string("stale"));
    CHECK(reasons_have(r["verdict"], "stale:nika"));
    CHECK(r["verdict"]["fallback_used"].as_bool());
  }
  {
    Alarm a;
    Value door = op("set_door");
    door.set("id", "d_power_garage");
    door.set("state", "open");
    Value water = op("set_resource");
    water.set("id", "water_l");
    water.set("amount", 850);
    a.w.patch(ops({door, water}));  // unrelated to the proposal: still accepted
    CHECK(a.w.core().st.revision > a.req["world_revision"].as_int());
    const Value r = a.w.submit(a.id, intent("inspect", "sensor_a", "nika"));
    CHECK_EQ(r["verdict"]["status"].str(), std::string("awaiting_player"));
  }
}

TEST(authority, facts_not_offered_protected_or_foreign_rejected) {
  {
    Alarm a;  // Mira knows sector_c_checked_empty, but it is not relevant to the alarm, so it was not offered
    const Value r = a.w.submit(a.id, intent("inspect", "sensor_a", "nika", {"sector_c_checked_empty"}));
    CHECK_EQ(r["verdict"]["status"].str(), std::string("rejected"));
    CHECK(reasons_have(r["verdict"], "fact_not_offered:sector_c_checked_empty"));
    CHECK_EQ(r["verdict"]["steps"].at(3)["ok"].as_bool(), false);
  }
  {
    Alarm a;
    const Value r = a.w.submit(a.id, intent("report_observation", "", "", {"airlock_override_code"}));
    CHECK(reasons_have(r["verdict"], "fact_protected:airlock_override_code"));
  }
  {
    Alarm a;  // Leila's private knowledge
    const Value r = a.w.submit(a.id, intent("report_observation", "", "", {"sample_07_needs_cold"}));
    CHECK(reasons_have(r["verdict"], "fact_not_offered:sample_07_needs_cold"));
    // Even if a host offered it by mistake, Mira does not know it.
    echo::Offer forged = echo::offer_from_request(a.req);
    forged.visible_facts.push_back("sample_07_needs_cold");
    echo::Proposal p;
    p.action = "report_observation";
    p.fact_ids = {"sample_07_needs_cold"};
    p.style = "neutral";
    const auto reasons = echo::check_validity(a.w.core(), "mira", p, &forged, "");
    CHECK(echo::contains(reasons, "fact_unknown_to_actor:sample_07_needs_cold"));
  }
}

TEST(authority, target_not_offered_and_role_skill) {
  Alarm a;
  const Value r = a.w.submit(a.id, intent("inspect", "garage", "", {}));
  CHECK(reasons_have(r["verdict"], "target_not_offered:garage"));
  echo::Proposal repair;
  repair.action = "repair";
  repair.target = "sensor_a";
  repair.style = "neutral";
  const auto leila = echo::check_validity(a.w.core(), "leila", repair, nullptr, "");
  CHECK(echo::contains(leila, "role_not_allowed:geologist"));
  echo::Proposal drone;
  drone.action = "drone_survey";
  drone.target = "niche_a";
  drone.style = "neutral";
  CHECK(echo::contains(echo::check_validity(a.w.core(), "mira", drone, nullptr, ""), "role_not_allowed:life_support"));
  // Skill threshold: a robotics engineer with too little robotics skill cannot fly the drone.
  Value data = d0_data();
  Value& npcs = *data.find_mut("npcs");
  for (auto& n : npcs.find_mut("npcs")->items_mut()) {
    if (n["id"].str() == "nika") n.find_mut("skills")->set("robotics", 0.3);
  }
  echo::Engine e;
  e.call(echo::json::dump(echo::host::init_request(data)));
  CHECK(echo::contains(echo::check_validity(e.core(), "nika", drone, nullptr, ""), "skill_too_low:robotics"));
}

TEST(authority, busy_companion_rejected) {
  Alarm a;
  a.w.patch(ops({busy("nika")}));
  echo::Proposal p;
  p.action = "inspect";
  p.target = "sensor_a";
  p.companion = "nika";
  p.style = "concerned";
  CHECK(echo::contains(echo::check_validity(a.w.core(), "mira", p, nullptr, ""), "companion_busy:nika"));
  // A request built now does not even offer Nika as a companion.
  World w;
  w.run_until(20.5);
  w.patch(ops({busy("nika")}));
  const Value req = w.dispatch_for("mira");
  for (const auto& act : req["allowed_actions"].items()) {
    for (const auto& comp : act["companions"].items()) CHECK(comp["id"].str() != "nika");
  }
  const Value r = w.submit(req["task_id"].str(), intent("inspect", "sensor_a", "nika"));
  CHECK(reasons_have(r["verdict"], "companion_not_offered:nika"));
}

TEST(authority, sealed_route_rejected) {
  World w;
  Value door = op("set_door");
  door.set("id", "d_hab_niche_a");
  door.set("state", "sealed");
  w.patch(ops({door}));
  echo::Proposal p;
  p.action = "inspect";
  p.target = "sensor_a";
  p.style = "neutral";
  const auto reasons = echo::check_validity(w.core(), "mira", p, nullptr, "");
  CHECK(echo::contains(reasons, "zone_sealed:niche_a"));
  // Sector C is reachable only through the workshop.
  Value door2 = op("set_door");
  door2.set("id", "d_ws_sector_c");
  door2.set("state", "sealed");
  w.patch(ops({door2}));
  p.target = "sector_c";
  CHECK(!echo::check_validity(w.core(), "nika", p, nullptr, "").empty());
}

TEST(authority, eva_physical_rules) {
  World w;
  Value tired = op("set_fatigue");
  tired.set("actor", "yun");
  tired.set("value", 0.9);
  w.patch(ops({tired}));
  echo::Proposal p;
  p.action = "inspect";
  p.target = "surface";
  p.style = "neutral";
  CHECK(echo::contains(echo::check_validity(w.core(), "yun", p, nullptr, ""), "eva_fatigue:yun"));
  CHECK(echo::contains(echo::check_validity(w.core(), "thomas", p, nullptr, ""), "eva_skill:thomas"));
  CHECK(echo::check_validity(w.core(), "mira", p, nullptr, "").empty());
  p.companion = "thomas";  // a companion must also be fit for the suit
  CHECK(echo::contains(echo::check_validity(w.core(), "mira", p, nullptr, ""), "eva_skill:thomas"));
}

TEST(authority, resource_shortage_rejected) {
  Alarm a;
  Value seals = op("set_resource");
  seals.set("id", "spare_seals");
  seals.set("amount", 0);
  a.w.patch(ops({seals}));
  echo::Proposal p;
  p.action = "repair";
  p.target = "sensor_a";
  p.style = "neutral";
  CHECK(echo::contains(echo::check_validity(a.w.core(), "mira", p, nullptr, ""), "resource_short:spare_seals"));
}

TEST(authority, two_proposals_for_last_sealant_exactly_one_reserves) {
  World w;
  w.run_until(5);
  Value sealant = op("set_resource");
  sealant.set("id", "sealant");
  sealant.set("amount", 1);
  w.patch(ops({sealant}));
  w.say("mira", "Мира, что скажешь?");
  w.say("samir", "Самир, что скажешь?");
  const Value r1 = w.dispatch("rules");
  const Value r2 = w.dispatch("rules");
  REQUIRE(!r1["request"].is_null() && !r2["request"].is_null());
  const Value& mira_req = r1["request"]["actor_id"].str() == "mira" ? r1["request"] : r2["request"];
  const Value& samir_req = r1["request"]["actor_id"].str() == "samir" ? r1["request"] : r2["request"];
  const Value a = w.submit(mira_req["task_id"].str(), intent("prepare_isolation", "niche_a", "", {}, "firm"));
  const Value b = w.submit(samir_req["task_id"].str(), intent("prepare_isolation", "sector_c", "", {}, "dry"));
  CHECK_EQ(a["verdict"]["status"].str(), std::string("awaiting_player"));
  CHECK_EQ(b["verdict"]["status"].str(), std::string("stale"));
  CHECK(reasons_have(b["verdict"], "stale:sealant"));
  CHECK_EQ(resource(w, "sealant", "reserved"), 1.0);
  int isolation_plans = 0;
  const Value st = w.state();
  for (const auto& p : st["plans"].items()) {
    if (p["proposal"]["action"].str() == "prepare_isolation" && p["state"].str() == "awaiting_player") ++isolation_plans;
  }
  CHECK_EQ(isolation_plans, 1);
  // A fresh request after the reservation no longer offers isolation at all.
  w.say("samir", "Самир, загерметизируй сектор C.");
  const Value fresh = w.dispatch_for("samir");
  for (const auto& act : fresh["allowed_actions"].items()) CHECK(act["id"].str() != "prepare_isolation");
  CHECK_EQ(w.core().rt.ai.violations_admitted, 0u);
}

TEST(authority, plan_accept_after_companion_busy_replans_without_double_spend) {
  Alarm a;
  const Value r = a.w.submit(a.id, intent("prepare_isolation", "niche_a", "nika", {"pressure_disagreement"}, "firm"));
  REQUIRE(r["verdict"]["status"].str() == "awaiting_player");
  const std::string plan = r["verdict"]["plan_id"].str();
  CHECK_EQ(resource(a.w, "sealant", "reserved"), 1.0);
  a.w.patch(ops({busy("nika")}));
  const Value d = a.w.decide(plan, "accept");
  REQUIRE(d["ok"].as_bool());
  CHECK_EQ(d["verdict"]["status"].str(), std::string("accepted"));
  CHECK(reasons_have(d["verdict"], "companion_busy:nika"));
  CHECK(reasons_have(d["verdict"], "replanned_companion:"));
  CHECK_EQ(plan_state(a.w, plan), std::string("replanned"));
  CHECK_EQ(resource(a.w, "sealant", "reserved"), 1.0);  // transferred, not reserved twice
  const echo::Task* t = task_of(a.w, d["verdict"]["world_task_id"].str());
  REQUIRE(t != nullptr);
  CHECK(t->companion != "nika" && !t->companion.empty());
  a.w.run_until(200);
  CHECK_EQ(resource(a.w, "sealant", "amount"), 2.0);
  CHECK_EQ(resource(a.w, "sealant", "reserved"), 0.0);
  CHECK_EQ(a.w.core().rt.ai.violations_admitted, 0u);
}

TEST(authority, plan_reassign_evidence_and_reject) {
  {
    Alarm a;
    const std::string plan = a.w.submit(a.id, intent("inspect", "sensor_a", "nika", {"pressure_disagreement", "yun_sent_alone"}))["verdict"]["plan_id"].str();
    const Value ev = a.w.decide(plan, "ask_evidence");
    CHECK_EQ(ev["verdict"]["status"].str(), std::string("awaiting_player"));
    CHECK_EQ(ev["speech"]["kind"].str(), std::string("evidence"));
    CHECK(ev["speech"]["text"].str().find("механический манометр там же стабилен") != std::string::npos);
    CHECK(ev["speech"]["text"].str().find("Алекс отправил Юна одного") != std::string::npos);
    const Value bad = a.w.decide(plan, "reassign", "mira");
    CHECK_EQ(bad["verdict"]["status"].str(), std::string("rejected"));
    CHECK_EQ(plan_state(a.w, plan), std::string("awaiting_player"));
    // Thomas has his own plan waiting (rest for Yun), so he is not free; Samir is.
    const Value busy_thomas = a.w.decide(plan, "reassign", "thomas");
    CHECK_EQ(busy_thomas["verdict"]["status"].str(), std::string("rejected"));
    const Value re = a.w.decide(plan, "reassign", "samir");
    CHECK_MSG(re["verdict"]["status"].str() == "accepted", echo::json::dump(re["verdict"]));
    const echo::Task* t = task_of(a.w, re["verdict"]["world_task_id"].str());
    REQUIRE(t != nullptr);
    CHECK_EQ(t->companion, std::string("samir"));
  }
  {
    Alarm a;
    const std::string plan = a.w.submit(a.id, intent("prepare_isolation", "niche_a", "", {}, "firm"))["verdict"]["plan_id"].str();
    CHECK_EQ(resource(a.w, "sealant", "reserved"), 1.0);
    const double trust_before = a.w.core().st.actors.at("mira").trust_player;
    const Value rej = a.w.decide(plan, "reject");
    CHECK_EQ(rej["verdict"]["status"].str(), std::string("rejected"));
    CHECK(rej["verdict"]["fallback_used"].as_bool());
    CHECK_EQ(resource(a.w, "sealant", "reserved"), 0.0);
    CHECK(a.w.core().st.actors.at("mira").trust_player < trust_before);
    bool remembered = false;
    for (const auto& e : a.w.core().st.memory.at("mira").entries) remembered = remembered || e.text_ru.find("Алекс отклонил") != std::string::npos;
    CHECK(remembered);
    // The fallback after a rejection never asks for approval again.
    const Value fb = rej["verdict"]["fallback"];
    CHECK(fb["status"].str() == "accepted");
    const Value again = a.w.decide(plan, "accept");
    CHECK(!again["ok"].as_bool());
  }
}

TEST(authority, plan_ttl_expiry_releases_reservation) {
  Alarm a;
  const std::string plan = a.w.submit(a.id, intent("prepare_isolation", "niche_a", "", {}, "firm"))["verdict"]["plan_id"].str();
  CHECK_EQ(resource(a.w, "sealant", "reserved"), 1.0);
  a.w.run_until(a.w.core().st.sim_ms / 1000.0 + 61);
  CHECK_EQ(plan_state(a.w, plan), std::string("expired"));
  CHECK_EQ(resource(a.w, "sealant", "reserved"), 0.0);
  CHECK(a.w.core().st.actors.at("mira").plan_id.empty());
}

TEST(authority, memory_unchanged_by_rejected_proposal) {
  Alarm a;
  const auto facts_before = a.w.core().st.memory.at("mira").facts.size();
  const Value r = a.w.submit(a.id, intent("inspect", "garage", "", {"airlock_override_code"}));
  CHECK_EQ(r["verdict"]["status"].str(), std::string("rejected"));
  const auto& mem = a.w.core().st.memory.at("mira");
  CHECK_EQ(mem.facts.size(), facts_before);
  for (const auto& e : mem.entries) {
    CHECK(!echo::contains(e.tags, "garage"));
    CHECK(e.text_ru.find("гараж") == std::string::npos);
  }
  for (const auto& acc : a.w.core().st.accepted) CHECK(acc.proposal_text.find("garage") == std::string::npos);
}

TEST(authority, provider_failure_status_falls_back) {
  for (const char* status : {"timeout", "refused", "invalid_output", "unavailable", "rate_limited", "budget_exceeded", "cancelled"}) {
    Alarm a;
    const Value r = a.w.submit(a.id, "", status);
    CHECK_EQ(r["verdict"]["status"].str(), std::string("fallback"));
    CHECK_EQ(r["verdict"]["fallback_reason"].str(), std::string(status));
    CHECK_EQ(r["speech"]["kind"].str(), std::string("fallback"));
    // The ordinary game AI still produced the useful action: Mira proposes the paired inspection.
    CHECK_EQ(r["verdict"]["fallback"]["proposal"]["action"].str(), std::string("inspect"));
  }
}

TEST(authority, cancel_discards_late_answer) {
  Alarm a;
  Value c = a.w.cmd("cancel");
  c.set("task_id", a.id);
  c.set("now_ms", a.w.now_ms);
  CHECK(a.w.call(c)["cancelled"].as_bool());
  const auto rev = a.w.core().st.revision;
  const Value r = a.w.submit(a.id, intent("repair", "sensor_a"));
  CHECK_EQ(r["verdict"]["status"].str(), std::string("rejected"));
  CHECK(reasons_have(r["verdict"], "cancelled"));
  CHECK_EQ(a.w.core().st.revision, rev);
  CHECK_EQ(resource(a.w, "spare_seals", "reserved"), 0.0);
}

TEST(authority, effects_only_at_completion_and_cancel_releases) {
  {
    Alarm a;
    const Value r = a.w.submit(a.id, intent("repair", "sensor_a", "", {"sensor_a_drop"}));
    REQUIRE(r["verdict"]["status"].str() == "accepted");
    CHECK(a.w.core().st.sensors.at("sensor_a").fault.size() > 0);
    CHECK(a.w.core().st.emergency_lights);
    CHECK_EQ(resource(a.w, "spare_seals", "amount"), 4.0);
    a.w.run_until(260);
    CHECK(a.w.core().st.sensors.at("sensor_a").fault.empty());
    CHECK(!a.w.core().st.emergency_lights);
    CHECK_EQ(a.w.core().st.sensors.at("sensor_a").reading.value, 101.2);
    CHECK_EQ(resource(a.w, "spare_seals", "amount"), 3.0);
  }
  {
    Alarm a;
    const Value r = a.w.submit(a.id, intent("repair", "sensor_a"));
    const std::string task = r["verdict"]["world_task_id"].str();
    Value c = a.w.cmd("cancel");
    c.set("task_id", task);
    c.set("now_ms", a.w.now_ms);
    CHECK(a.w.call(c)["cancelled"].as_bool());
    CHECK_EQ(resource(a.w, "spare_seals", "reserved"), 0.0);
    CHECK_EQ(resource(a.w, "spare_seals", "amount"), 4.0);
    CHECK(!a.w.core().st.sensors.at("sensor_a").fault.empty());
    CHECK(a.w.core().st.items.at("diag_kit").lock.empty());
  }
}

TEST(authority, player_order_comply_and_refuse) {
  {
    World w;
    w.run_until(21);
    w.order("mira", "inspect", "sensor_a", "nika");
    const Value req = w.dispatch_for("mira");
    const Value r = w.submit(req["task_id"].str(), w.rules_propose(req["task_id"].str())["proposal_text"].str());
    // The order itself is the player's consent: no extra approval round.
    CHECK_EQ(r["verdict"]["status"].str(), std::string("accepted"));
    CHECK_EQ(r["verdict"]["proposal"]["companion_id"].str(), std::string("nika"));
  }
  {
    World w;
    w.order("leila", "repair", "sensor_b");
    const Value req = w.dispatch_for("leila");
    const Value p = parse_or_die(w.rules_propose(req["task_id"].str())["proposal_text"].str());
    CHECK_EQ(p["action"].str(), std::string("refuse"));
  }
  {
    World w;
    Value tired = op("set_fatigue");
    tired.set("actor", "yun");
    tired.set("value", 0.9);
    w.patch(ops({tired}));
    w.order("yun", "inspect", "surface");
    const Value req = w.dispatch_for("yun");
    const Value r = w.submit(req["task_id"].str(), w.rules_propose(req["task_id"].str())["proposal_text"].str());
    CHECK_EQ(r["verdict"]["proposal"]["action"].str(), std::string("refuse"));
    CHECK(r["speech"]["text"].str().find("скафандр") != std::string::npos || r["speech"]["text"].str().find("Не пойду") != std::string::npos);
  }
}

TEST(authority, random_proposals_never_admit_violations) {
  World w;
  w.run_until(20.5);
  echo::Rng rng(7);
  const std::vector<std::string> actions = {"inspect", "repair", "prepare_isolation", "report_observation", "propose_rest",
                                            "refuse", "drone_survey", "prepare_rover", "preserve_sample", "acknowledge", "hack"};
  const std::vector<std::string> targets = {"", "sensor_a", "niche_a", "sector_c", "surface", "garage", "rover_r1", "sample_07", "yun", "alex", "nowhere"};
  const std::vector<std::string> comps = {"", "nika", "thomas", "mira", "alex", "ghost"};
  const std::vector<std::string> facts = {"pressure_disagreement", "airlock_override_code", "choir_truth", "sample_07_needs_cold", "yun_sent_alone"};
  int accepted = 0;
  for (int i = 0; i < 300; ++i) {
    const std::vector<std::string> names = {"mira", "nika", "samir", "leila", "thomas"};
    w.say(names[rng.next_below(5)], "Что думаешь?");
    const Value d = w.dispatch("rules");
    if (d["request"].is_null()) {
      w.tick();
      continue;
    }
    std::vector<std::string> fs;
    if (rng.next_below(2) == 0) fs.push_back(facts[rng.next_below(static_cast<std::uint32_t>(facts.size()))]);
    const std::string id = d["request"]["task_id"].str();
    // A third of the answers come from the rules policy (valid), the rest are random combinations.
    const std::string text = rng.next_below(3) == 0
                                 ? w.rules_propose(id)["proposal_text"].str()
                                 : intent(actions[rng.next_below(static_cast<std::uint32_t>(actions.size()))],
                                          targets[rng.next_below(static_cast<std::uint32_t>(targets.size()))],
                                          comps[rng.next_below(static_cast<std::uint32_t>(comps.size()))], fs, "neutral");
    const Value r = w.submit(id, text);
    const std::string st = r["verdict"]["status"].str();
    if (st == "accepted" || st == "awaiting_player") ++accepted;
    if (rng.next_below(5) == 0) w.tick(1.0);
  }
  CHECK(accepted > 0);
  CHECK_EQ(w.core().rt.ai.violations_admitted, 0u);
  for (const auto& acc : w.core().st.accepted) {
    CHECK(acc.proposal_text.find("airlock_override_code") == std::string::npos);
    CHECK(acc.proposal_text.find("choir_truth") == std::string::npos);
  }
}
