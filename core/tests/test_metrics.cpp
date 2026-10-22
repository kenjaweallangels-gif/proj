#include <string>
#include <vector>

#include "echo/metrics.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

Value sample(double interval, double cpu, double gpu) {
  Value s = Value::object();
  s.set("interval_ms", interval);
  s.set("cpu_ms", cpu);
  s.set("gpu_ms", gpu < 0 ? Value() : Value(gpu));
  return s;
}

Value send_frames(World& w, const Value& samples, const char* phase = "warm") {
  Value f = w.cmd("frame_stats");
  f.set("samples", samples);
  f.set("now_ms", w.now_ms);
  f.set("phase", phase);
  return w.call(f);
}

}  // namespace

TEST(metrics, percentiles_nearest_rank) {
  std::vector<double> v;
  for (int i = 100; i >= 1; --i) v.push_back(i);
  const auto p = echo::percentiles(v);
  CHECK_EQ(p.p50, 50.0);
  CHECK_EQ(p.p95, 95.0);
  CHECK_EQ(p.p99, 99.0);
  CHECK_EQ(p.max, 100.0);
  CHECK_EQ(p.mean, 50.5);
  CHECK_EQ(p.count, static_cast<std::size_t>(100));
  const auto one = echo::percentiles({7.0});
  CHECK_EQ(one.p50, 7.0);
  CHECK_EQ(one.p99, 7.0);
  CHECK_EQ(echo::percentiles({}).count, static_cast<std::size_t>(0));
}

TEST(metrics, frame_report_is_honest) {
  World w;
  CHECK_EQ(w.call(w.cmd("metrics"))["frame"]["frame_interval"].str(), std::string("unavailable"));
  Value s = Value::array();
  for (int i = 0; i < 97; ++i) s.push(sample(16.6, 5, -1));
  s.push(sample(20, 5, -1));    // missed deadline
  s.push(sample(40, 5, -1));    // pause > 33.3 ms
  s.push(sample(120, 5, -1));   // long pause
  send_frames(w, s);
  Value cold = Value::array();
  for (int i = 0; i < 10; ++i) cold.push(sample(50, 30, 20));
  send_frames(w, cold, "cold");
  const Value f = w.call(w.cmd("metrics"))["frame"];
  CHECK_EQ(f["gpu"].str(), std::string("unavailable"));  // no timestamp-query: never CPU in disguise
  CHECK_EQ(f["count"].as_int(), 100);
  CHECK_EQ(f["missed_deadline_ratio"].as_number(), 0.03);
  CHECK_EQ(f["pauses_over_33ms"].as_int(), 2);
  CHECK_EQ(f["max_pause_ms"].as_number(), 120.0);
  CHECK_EQ(f["frame_interval"]["p50"].as_number(), static_cast<double>(16.6f));
  CHECK(f["cold"]["gpu"].is_object());
  CHECK_EQ(f["cold"]["count"].as_int(), 10);
  CHECK(f["note_ru"].str().find("SwiftShader") != std::string::npos);
}

TEST(metrics, ai_report_counts_latency_fallbacks_tokens_and_violations) {
  World w;
  w.run_until(20.5);
  const Value req = w.dispatch_for("mira");
  Value res = w.result(req["task_id"].str(), intent("inspect", "sensor_a", "nika", {"pressure_disagreement"}));
  res.set("cost_usd", 0.0004);
  res.set("cost_is_fictional", true);
  w.submit_result(res);
  w.say("nika", "Ника, что видишь?");
  const Value r2 = w.dispatch("cpu");
  w.submit(r2["request"]["task_id"].str(), "{\"action\":\"inspect\",\"task_id\":\"x\",\"style\":\"neutral\"}");  // invalid
  w.say("samir", "Самир?");
  const Value r3 = w.dispatch("cpu");
  w.submit(r3["request"]["task_id"].str(), "", "timeout");
  const Value ai = w.call(w.cmd("metrics"))["ai"];
  CHECK(ai["latency_ms"]["first_token"].is_object());
  CHECK(ai["latency_ms"]["ready"].is_object());
  CHECK_EQ(ai["invalid_intents"].as_int(), 1);
  CHECK_EQ(ai["violations_admitted"].as_int(), 0);
  CHECK_EQ(ai["fallback"]["by_reason"]["timeout"].as_int(), 1);
  CHECK_EQ(ai["fallback"]["by_reason"]["invalid_output"].as_int(), 1);
  CHECK(ai["tokens"]["input"].as_int() >= 900);
  CHECK(ai["tokens"]["measured_results"].as_int() >= 3);
  CHECK(ai["cost"]["fictional"].as_bool());
  CHECK(ai["speech"]["lines"].as_int() > 0);
  CHECK(ai["speech"]["repetition_rate"].as_number() >= 0.0);
  CHECK(ai["models_seen"].size() >= 1);
}
