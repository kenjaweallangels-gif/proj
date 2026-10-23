#include <string>
#include <vector>

#include "echo/admission.hpp"
#include "echo/util.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

Value set_mode(World& w, const char* mode, bool gpu, bool calibrated, const char* privacy, int cores = 0) {
  Value m = w.cmd("set_ai_mode");
  m.set("mode", mode);
  m.set("gpu_enabled", gpu);
  m.set("calibrated", calibrated);
  m.set("privacy_profile", privacy);
  if (cores > 0) m.set("cpu_cores", cores);
  return w.call(m);
}

// `n` samples of the same timing; gpu < 0 means "no timestamp" (null).
Value frames(World& w, int n, double interval, double cpu, double gpu, double vram, bool vram_known = true) {
  Value s = Value::array();
  for (int i = 0; i < n; ++i) {
    Value x = Value::object();
    x.set("interval_ms", interval);
    x.set("cpu_ms", cpu);
    x.set("gpu_ms", gpu < 0 ? Value() : Value(gpu));
    s.push(x);
  }
  Value f = w.cmd("frame_stats");
  f.set("samples", s);
  f.set("vram_free_gib", vram_known ? Value(vram) : Value());
  f.set("now_ms", w.now_ms);
  return w.call(f);
}

bool has_code(const Value& gate, const std::string& code) {
  for (const auto& c : gate["codes"].items()) {
    if (c.str() == code) return true;
  }
  return false;
}

bool has_cyrillic(const std::string& s) {
  for (std::size_t i = 0; i + 1 < s.size(); ++i) {
    const auto a = static_cast<unsigned char>(s[i]);
    if (a == 0xD0 || a == 0xD1) return true;
  }
  return false;
}

// A world in live GPU mode with ~2.5 s of good frame statistics.
void good_gpu(World& w, double gpu_ms = 9.0, double cpu_ms = 6.0, double vram = 3.0) {
  set_mode(w, "live", true, true, "offline");
  frames(w, 150, 16.67, cpu_ms, gpu_ms, vram);
}

}  // namespace

TEST(admission, one_active_generation_on_shared_model) {
  World w;
  w.say("mira", "Мира, как дела?");
  w.say("nika", "Ника, как дела?");
  const Value first = w.dispatch("cpu");
  CHECK(!first["request"].is_null());
  const Value second = w.dispatch("cpu");
  CHECK(second["request"].is_null());
  CHECK_EQ(second["decision"]["code"].str(), std::string("busy"));
  CHECK(has_cyrillic(second["decision"]["reason"].str()));
  // Rules do not occupy the model instance.
  CHECK(!w.dispatch("rules")["request"].is_null());
  // Once the generation is answered the lane frees up.
  w.submit(first["request"]["task_id"].str(), intent("acknowledge", "", "", {}, "neutral"));
  w.say("leila", "Лейла, привет");
  CHECK(!w.dispatch("cpu")["request"].is_null());
}

TEST(admission, new_event_replaces_unstarted_request_of_same_npc) {
  World w;
  const Value a = w.say("mira", "Мира, первая реплика");
  const Value b = w.say("mira", "Мира, вторая реплика");
  CHECK(!a["queued"].is_null() && !b["queued"].is_null());
  CHECK(has_event(b, "request_replaced"));
  int mira_items = 0;
  for (const auto& q : w.core().st.queue) mira_items += q.actor == "mira" ? 1 : 0;
  CHECK_EQ(mira_items, 1);
  CHECK_EQ(w.core().st.queue.back().task_id, b["queued"]["task_id"].str());
  // A lower-priority event does not replace a waiting direct reply; it is folded into it.
  echo::Situation sit;
  sit.origin = "ambient";
  const echo::EnqueueResult r = echo::enqueue_request(w.core(), "mira", "ambient", sit, w.now_ms, false);
  CHECK(r.queued.is_null());
  CHECK_EQ(r.decision.code, std::string("superseded"));
}

TEST(admission, bounded_queue_evicts_ambient_first) {
  World w;
  echo::Situation amb;
  amb.origin = "ambient";
  echo::enqueue_request(w.core(), "yun", "ambient", amb, w.now_ms, false);
  w.say("mira", "Мира?");
  w.say("nika", "Ника?");
  w.say("samir", "Самир?");
  const Value fifth = w.say("leila", "Лейла?");
  CHECK(static_cast<int>(w.core().st.queue.size()) <= 4);
  CHECK(has_event(fifth, "request_evicted"));
  for (const auto& q : w.core().st.queue) CHECK(q.kind != "ambient");
  // The evicted ambient remark becomes a ready-made line instead of silence.
  bool yun_spoke = false;
  for (const auto& e : fifth["events"].items()) yun_spoke = yun_spoke || (e["type"].str() == "speech" && e["actor"].str() == "yun");
  CHECK(yun_spoke);
  CHECK_EQ(w.core().rt.ai.evicted, 1u);
}

TEST(admission, emergency_bypasses_the_model) {
  World w;
  Value op = Value::object();
  op.set("op", "emergency");
  op.set("actor", "nika");
  op.set("text_ru", "Рядом искрит кабель.");
  Value ops = Value::array();
  ops.push(op);
  const Value r = w.patch(ops);
  REQUIRE(r["ok"].as_bool());
  for (const auto& q : w.core().st.queue) CHECK(q.actor != "nika");
  CHECK(has_event(r, "verdict"));
  CHECK(has_event(r, "speech"));
  CHECK_EQ(w.core().rt.ai.fallbacks, 0u);  // a rules reaction by design, not a failed model call
}

TEST(admission, gpu_gate_unknown_vram_denied) {
  World w;
  set_mode(w, "live", true, true, "offline");
  const Value r = frames(w, 150, 16.67, 6, 9, 0, false);
  CHECK(!r["gate"]["gpu_allowed"].as_bool());
  CHECK(has_code(r["gate"], "vram_unknown"));
  CHECK(r["gate"]["vram_free_gib"].is_null());
  w.say("mira", "Мира?");
  const Value d = w.dispatch("gpu");
  CHECK(d["request"].is_null());
  CHECK_EQ(d["decision"]["code"].str(), std::string("vram_unknown"));
}

TEST(admission, gpu_gate_stale_stats_denied) {
  World w;
  good_gpu(w);
  w.say("mira", "Мира?");
  CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
  w.now_ms += 1500;  // stats older than stats_max_age_s = 1 s
  const auto g = echo::evaluate_gate(w.core(), w.now_ms);
  CHECK(!g.gpu_allowed);
  CHECK(echo::contains(g.codes, "stats_stale"));
  CHECK(w.dispatch("gpu")["request"].is_null());
}

TEST(admission, gpu_gate_threshold_edges) {
  {
    World w;
    good_gpu(w, 11.49);
    CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
  }
  {
    World w;
    good_gpu(w, 11.5);  // p95 must be strictly below 11.5 ms
    const auto g = echo::evaluate_gate(w.core(), w.now_ms);
    CHECK(!g.gpu_allowed);
    CHECK(echo::contains(g.codes, "p95_gpu_high"));
  }
  {
    World w;
    good_gpu(w, 9.0, 14.0);  // p99 frame readiness must be strictly below 14 ms
    CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "p99_frame_high"));
  }
  {
    World w;
    good_gpu(w, 9.0, 6.0, 1.5);  // exactly the reserve: allowed
    CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
  }
  {
    World w;
    good_gpu(w, 9.0, 6.0, 1.49);
    CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "vram_low"));
  }
  {
    World w;  // no GPU timestamps at all: never substituted by CPU time
    set_mode(w, "live", true, true, "offline");
    frames(w, 150, 16.67, 6, -1, 3);
    const auto g = echo::evaluate_gate(w.core(), w.now_ms);
    CHECK(echo::contains(g.codes, "gpu_timing_unavailable"));
    CHECK(g.p95_gpu_ms < 0);
  }
  {
    World w;  // too short a window of good frames
    set_mode(w, "live", true, true, "offline");
    frames(w, 60, 16.67, 6, 9, 3);  // ~1 s
    CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "unstable"));
  }
}

TEST(admission, gpu_cooldown_after_degradation) {
  World w;
  good_gpu(w);
  CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
  w.now_ms += 500;
  const Value bad = frames(w, 30, 25, 6, 15, 3);
  CHECK(!bad["gate"]["gpu_allowed"].as_bool());
  CHECK(has_code(bad["gate"], "cooldown"));
  CHECK(bad["advice"].is_object());
  // Good frames again, but the cooldown (5 s) and the stability window (2 s) still hold the gate shut.
  for (int i = 0; i < 4; ++i) {
    w.now_ms += 1000;
    frames(w, 60, 16.67, 6, 9, 3);
  }
  CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "cooldown"));
  for (int i = 0; i < 3; ++i) {
    w.now_ms += 1000;
    frames(w, 60, 16.67, 6, 9, 3);
  }
  CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
}

TEST(admission, gpu_requires_enable_calibration_and_mode) {
  World w;
  frames(w, 150, 16.67, 6, 9, 3);
  set_mode(w, "smooth", true, true, "offline");
  CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "mode_smooth"));
  set_mode(w, "live", true, false, "offline");
  CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "not_calibrated"));
  set_mode(w, "live", false, true, "offline");
  CHECK(echo::contains(echo::evaluate_gate(w.core(), w.now_ms).codes, "gpu_disabled"));
  set_mode(w, "live", true, true, "offline");
  frames(w, 10, 16.67, 6, 9, 3);
  CHECK(echo::evaluate_gate(w.core(), w.now_ms).gpu_allowed);
}

TEST(admission, offline_privacy_blocks_remote) {
  World w;
  w.say("mira", "Мира?");
  set_mode(w, "smooth", false, false, "offline");
  const Value d = w.dispatch("remote");
  CHECK(d["request"].is_null());
  CHECK_EQ(d["decision"]["code"].str(), std::string("privacy_offline"));
  set_mode(w, "smooth", false, false, "hybrid");
  const Value ok = w.dispatch("remote");
  CHECK(!ok["request"].is_null());
  CHECK_EQ(ok["request"]["privacy_profile"].str(), std::string("hybrid"));
}

TEST(admission, extended_mode_forbidden_during_emergency) {
  World w;
  const Value cfg = set_mode(w, "extended", false, false, "offline");
  CHECK_EQ(cfg["config"]["effective_mode"].str(), std::string("extended"));
  w.say("nika", "Ника, расскажи подробнее.");
  CHECK_EQ(w.dispatch("cpu")["request"]["max_output_tokens"].as_int(), 320);
  w.run_until(21);  // pressure alarm
  const Value during = set_mode(w, "extended", false, false, "offline");
  CHECK_EQ(during["config"]["effective_mode"].str(), std::string("live"));
  CHECK(during["config"]["notes_ru"].size() > 0);
  w.say("leila", "Лейла, расскажи подробнее.");
  const Value req = w.dispatch_for("leila");
  CHECK_EQ(req["max_output_tokens"].as_int(), 160);
}

TEST(admission, priority_order_direct_reply_first) {
  World w;
  w.run_until(20.5);  // Mira's initiative (60) is queued
  w.say("samir", "Самир, сколько у нас энергии?");  // direct reply (80)
  const Value d = w.dispatch("cpu");
  CHECK_EQ(d["request"]["actor_id"].str(), std::string("samir"));
  CHECK_EQ(d["request"]["kind"].str(), std::string("direct_reply"));
}

TEST(admission, cpu_pool_follows_core_count) {
  World w;
  w.say("mira", "Мира?");
  set_mode(w, "smooth", false, false, "offline", 3);  // 3 cores - 2 = 1 thread < minimum 2
  const Value d = w.dispatch("cpu");
  CHECK_EQ(d["decision"]["code"].str(), std::string("cpu_insufficient"));
  const Value cfg = set_mode(w, "smooth", false, false, "offline", 12);
  CHECK_EQ(cfg["config"]["cpu_threads"].as_int(), 6);  // capped at max
  CHECK(!w.dispatch("cpu")["request"].is_null());
}

TEST(admission, decisions_carry_russian_reasons) {
  World w;
  const Value q = w.say("mira", "Мира, проверь датчик A.");
  CHECK(has_cyrillic(q["admission"]["reason"].str()));
  CHECK_EQ(q["immediate"]["kind"].str(), std::string("immediate"));
  const Value d = w.dispatch("gpu");
  CHECK(has_cyrillic(d["decision"]["reason"].str()));
  for (const auto& r : d["decision"]["gate"]["reasons"].items()) CHECK(has_cyrillic(r.str()));
}

TEST(admission, host_deadline_scale_stretches_model_deadlines_only_within_bounds) {
  World w;
  const Value base = w.say("mira", "Мира, как дела?");
  const double base_deadline = w.core().st.queue.back().deadline_ms - w.now_ms;
  CHECK(!base["queued"].is_null());
  CHECK_EQ(base_deadline, 2500.0);
  const Value bad = w.call_text(R"({"cmd":"set_ai_mode","mode":"smooth","gpu_enabled":false,"calibrated":false,"privacy_profile":"hybrid","deadline_scale":0.5})");
  CHECK_EQ(bad["error"]["code"].str(), std::string("invalid_argument"));
  const Value ok = w.call_text(R"({"cmd":"set_ai_mode","mode":"smooth","gpu_enabled":false,"calibrated":false,"privacy_profile":"hybrid","deadline_scale":4})");
  CHECK(ok["ok"].as_bool());
  CHECK_EQ(ok["config"]["deadline_scale"].as_number(), 4.0);
  w.say("leila", "Лейла, что нового?");
  CHECK_EQ(w.core().st.queue.back().deadline_ms - w.now_ms, 10000.0);
  // The setting survives save/load.
  const Value saved = w.call_text(R"({"cmd":"save"})");
  CHECK_EQ(saved["save"]["ai_config"]["deadline_scale"].as_number(), 4.0);
}
