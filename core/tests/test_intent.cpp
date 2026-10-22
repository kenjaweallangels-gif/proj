#include <string>
#include <vector>

#include "echo/authority.hpp"
#include "echo/context.hpp"
#include "echo/util.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;
using echo::Offer;
using echo::Proposal;

namespace {

// Mira's alarm request (t ≈ 20 s) and its offer: the realistic context for format checks.
struct AlarmContext {
  World w;
  Value request;
  Offer offer;
  AlarmContext() {
    w.run_until(20.5);
    request = w.dispatch_for("mira");
    offer = echo::offer_from_request(request);
  }
  std::vector<std::string> reasons(const std::string& text) {
    Proposal p;
    std::vector<std::string> r;
    echo::parse_intent(w.core(), text, offer, p, r);
    return r;
  }
  bool ok(const std::string& text) {
    Proposal p;
    std::vector<std::string> r;
    return echo::parse_intent(w.core(), text, offer, p, r);
  }
};

bool has_prefix(const std::vector<std::string>& reasons, const std::string& prefix) {
  for (const auto& r : reasons) {
    if (echo::starts_with(r, prefix)) return true;
  }
  return false;
}

}  // namespace

TEST(intent, valid_minimal_and_full_accepted) {
  AlarmContext ctx;
  REQUIRE(!ctx.request.is_null());
  CHECK(ctx.ok(R"({"action":"acknowledge","style":"neutral"})"));
  CHECK(ctx.ok(R"({"action":"inspect","target_id":"sensor_a","companion_id":"nika","fact_ids":["pressure_disagreement"],"style":"concerned","gesture":"point_at_target"})"));
  CHECK(ctx.ok(R"({"action":"acknowledge","target_id":null,"companion_id":null,"fact_ids":[],"style":"warm"})"));
  Proposal p;
  std::vector<std::string> r;
  REQUIRE(echo::parse_intent(ctx.w.core(), R"({"action":"inspect","target_id":"sensor_a","style":"concerned"})", ctx.offer, p, r));
  CHECK_EQ(p.gesture, std::string("point_at_target"));  // default gesture of the action
}

TEST(intent, unknown_and_host_owned_fields_1000_variants_rejected) {
  AlarmContext ctx;
  echo::Rng rng(20261021);
  const std::vector<std::string> host = {"task_id", "actor_id", "world_revision", "deadline_ms"};
  const std::vector<std::string> extra = {"secret", "reason", "line", "text", "command", "tool", "code", "admin", "eval",
                                          "Action", "ACTION", "style ", "fact_id", "facts", "target", "companion", "__proto__",
                                          "constructor", "prompt", "system"};
  const std::vector<std::string> values = {"1", "\"x\"", "null", "true", "[]", "{}", "\"req-000001\"", "999999", "\"mira\""};
  int rejected = 0;
  for (int i = 0; i < 1000; ++i) {
    std::string key;
    const auto pick = rng.next_below(3);
    if (pick == 0) key = host[rng.next_below(static_cast<std::uint32_t>(host.size()))];
    else if (pick == 1) key = extra[rng.next_below(static_cast<std::uint32_t>(extra.size()))];
    else key = "f" + std::to_string(rng.next_below(100000));
    const std::string value = values[rng.next_below(static_cast<std::uint32_t>(values.size()))];
    std::vector<std::string> fields = {"\"action\":\"inspect\"", "\"target_id\":\"sensor_a\"", "\"style\":\"concerned\""};
    if (rng.next_below(2) == 0) fields.push_back("\"fact_ids\":[\"pressure_disagreement\"]");
    const std::size_t pos = rng.next_below(static_cast<std::uint32_t>(fields.size() + 1));
    fields.insert(fields.begin() + static_cast<std::ptrdiff_t>(pos), echo::json::quote(key) + ":" + value);
    const std::string text = "{" + echo::join(fields, ",") + "}";
    const auto r = ctx.reasons(text);
    if (has_prefix(r, "unknown_field:")) ++rejected;
    else CHECK_MSG(false, "принят вариант: " + text);
  }
  CHECK_EQ(rejected, 1000);
}

TEST(intent, host_owned_fields_each_rejected_end_to_end) {
  for (const char* field : {"task_id", "actor_id", "world_revision", "deadline_ms"}) {
    AlarmContext ctx;
    const std::string text = std::string("{\"action\":\"inspect\",\"target_id\":\"sensor_a\",\"style\":\"concerned\",\"") + field +
                             "\":\"" + ctx.request["task_id"].str() + "\"}";
    const Value r = ctx.w.submit(ctx.request["task_id"].str(), text);
    REQUIRE(r["ok"].as_bool());
    CHECK_EQ(r["verdict"]["status"].str(), std::string("rejected"));
    CHECK(r["verdict"]["fallback_used"].as_bool());
    CHECK_EQ(r["verdict"]["steps"].at(0)["ok"].as_bool(), false);
    CHECK_EQ(r["verdict"]["reasons"].at(0).str(), std::string("unknown_field:") + field);
  }
}

TEST(intent, duplicate_keys_rejected) {
  AlarmContext ctx;
  const auto r = ctx.reasons(R"({"action":"inspect","target_id":"sensor_a","action":"acknowledge","style":"neutral"})");
  CHECK(has_prefix(r, "duplicate_key:action"));
}

TEST(intent, byte_limit_2048) {
  AlarmContext ctx;
  const std::string base = R"({"action":"acknowledge","style":"neutral"})";
  std::string exact = base;
  exact.insert(1, std::string(2048 - base.size(), ' '));
  CHECK_EQ(exact.size(), static_cast<std::size_t>(2048));
  CHECK(ctx.ok(exact));
  std::string over = base;
  over.insert(1, std::string(2049 - base.size(), ' '));
  CHECK(has_prefix(ctx.reasons(over), "too_large"));
}

TEST(intent, depth_limit_4) {
  AlarmContext ctx;
  CHECK(has_prefix(ctx.reasons(R"({"action":"acknowledge","style":"neutral","fact_ids":[[[["x"]]]]})"), "depth_exceeded"));
}

TEST(intent, wrong_types_and_enums) {
  AlarmContext ctx;
  struct Case {
    const char* text;
    const char* reason;
  };
  const Case cases[] = {
      {R"({"action":"inspect","style":"angry"})", "bad_style"},
      {R"({"action":"acknowledge","style":"neutral","gesture":"dance"})", "bad_gesture"},
      {R"({"action":5,"style":"neutral"})", "wrong_type:action"},
      {R"({"action":"inspect","target_id":"Sensor-A","style":"neutral"})", "bad_pattern:target_id"},
      {R"({"action":"inspect","target_id":7,"style":"neutral"})", "wrong_type:target_id"},
      {R"({"action":"acknowledge","fact_ids":"x","style":"neutral"})", "wrong_type:fact_ids"},
      {R"({"action":"acknowledge","fact_ids":["sensor_a_drop","sensor_a_drop"],"style":"neutral"})", "fact_ids_not_unique"},
      {R"({"action":"acknowledge","fact_ids":["sensor_a_drop","pressure_disagreement","yun_sent_alone"],"style":"neutral"})", "fact_ids_too_many"},
      {R"({"action":"report_observation","fact_ids":[],"style":"neutral"})", "fact_ids_too_few"},
      {R"({"action":"drone_survey","target_id":"niche_a","style":"neutral"})", "action_not_offered"},
      {R"({"action":"open_airlock","style":"neutral"})", "action_not_offered"},
      {R"({"action":"inspect"})", "missing_field:style"},
      {R"({"style":"neutral"})", "missing_field:action"},
      {R"(["inspect"])", "not_object"},
      {R"("inspect")", "not_object"},
      {R"({"action":"inspect","style":"neutral"} {"x":1})", "bad_json"},
      {"{\"action\":\"inspect\",\"style\":\"neutral\",\"gesture\":null}", "wrong_type:gesture"},
  };
  for (const auto& cs : cases) {
    const auto r = ctx.reasons(cs.text);
    CHECK_MSG(has_prefix(r, cs.reason), std::string(cs.text) + " → " + echo::join(r, ","));
  }
}
