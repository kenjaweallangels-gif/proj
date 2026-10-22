#include <set>
#include <string>

#include "echo/rules.hpp"
#include "echo/speech.hpp"
#include "echo/world.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

echo::SpeechRequest req_for(const std::string& actor, const std::string& stage, const std::string& action,
                            const std::string& style, const std::string& target = "", const std::string& companion = "") {
  echo::SpeechRequest r;
  r.actor = actor;
  r.stage = stage;
  r.action = action;
  r.style = style;
  r.target = target;
  r.companion = companion;
  return r;
}

}  // namespace

TEST(speech, library_size_and_coverage) {
  World w;
  const auto& sd = w.core().data.speech;
  CHECK(sd.templates.size() >= 150);
  std::set<std::string> kinds;
  for (const auto& t : sd.templates) kinds.insert(t.kind);
  for (const char* k : {"immediate", "line", "fallback", "evidence"}) CHECK(kinds.count(k) == 1);
  // Every NPC: an immediate reaction, a plan-free acknowledgement and a refusal in every style.
  for (const auto& n : w.core().data.crew) {
    if (n.is_player) continue;
    for (const auto& style : w.core().data.styles) {
      for (const auto& [stage, action] : std::vector<std::pair<std::string, std::string>>{
               {"react", ""}, {"say", "acknowledge"}, {"say", "refuse"}}) {
        echo::SpeechRequest r = req_for(n.id, stage, action, style);
        if (stage == "react") r.kind = "immediate";
        const echo::Speech s = echo::render_speech(w.core(), r);
        CHECK_MSG(s.template_id != "core.minimal", n.id + "/" + stage + "/" + action + "/" + style);
      }
    }
  }
  // Every action that an NPC can take has start/propose/done lines.
  for (const auto& a : w.core().data.actions) {
    if (a.instant()) continue;
    bool start = false, done = false;
    for (const auto& t : sd.templates) {
      if (t.action != a.id) continue;
      start = start || t.stage == "start" || t.stage == "propose";
      done = done || t.stage == "done";
    }
    CHECK_MSG(start && done, a.id);
  }
}

TEST(speech, mira_canonical_line_when_she_remembers) {
  World w;
  w.run_until(20.5);
  const Value req = w.dispatch_for("mira");
  const Value r = w.submit(req["task_id"].str(), intent("inspect", "sensor_a", "nika", {"pressure_disagreement"}));
  CHECK_EQ(r["speech"]["text"].str(), std::string("Я проверю датчик A. Ника останется у шлюза — после прошлого раза по одному не идём."));
  CHECK_EQ(r["speech"]["actor"].str(), std::string("mira"));
  CHECK_EQ(r["speech"]["gesture"].str(), std::string("point_at_target"));
}

TEST(speech, never_contains_protected_or_unoffered_facts) {
  World w;
  w.run_until(20.5);
  echo::Rng rng(99);
  const std::vector<std::string> all_facts = [&] {
    std::vector<std::string> v;
    for (const auto& f : w.core().data.facts) v.push_back(f.id);
    return v;
  }();
  const std::vector<std::string> allowed = {"pressure_disagreement", "sensor_a_drop"};
  const std::vector<std::string> stages = {"say", "propose", "start", "done", "evidence"};
  const std::vector<std::string> actions = {"report_observation", "refuse", "inspect", "acknowledge"};
  for (int i = 0; i < 2000; ++i) {
    echo::SpeechRequest r = req_for("mira", stages[rng.next_below(5)], actions[rng.next_below(4)], "concerned", "sensor_a", "nika");
    if (r.stage == "evidence") r.kind = "evidence";
    for (int k = 0; k < 3; ++k) r.fact_ids.push_back(all_facts[rng.next_below(static_cast<std::uint32_t>(all_facts.size()))]);
    r.allowed_facts = &allowed;
    const echo::Speech s = echo::render_speech(w.core(), r);
    CHECK(!echo::contains_protected_text(w.core(), s.text));
    for (const auto& f : s.fact_ids) CHECK_MSG(echo::contains(allowed, f), f);
    for (const auto& f : w.core().data.facts) {
      if (!echo::contains(allowed, f.id)) CHECK_MSG(s.text.find(f.text_ru) == std::string::npos, s.text);
    }
  }
  // Facts the speaker does not know never get voiced even without a request context.
  echo::SpeechRequest r = req_for("mira", "say", "report_observation", "neutral");
  r.fact_ids = {"sample_07_needs_cold", "choir_truth"};
  const echo::Speech s = echo::render_speech(w.core(), r);
  CHECK(s.text.find("Образец 07") == std::string::npos);
  CHECK(s.fact_ids.empty());
}

TEST(speech, anti_repetition) {
  World w;
  std::string prev;
  int repeats = 0;
  for (int i = 0; i < 12; ++i) {
    const echo::Speech s = echo::render_speech(w.core(), req_for("yun", "say", "acknowledge", "neutral"));
    echo::say(w.core(), s, "sim");
    if (s.template_id == prev) ++repeats;
    prev = s.template_id;
  }
  CHECK_EQ(repeats, 0);
  CHECK(w.core().rt.ai.speech_lines >= 12);
}

TEST(speech, evidence_cites_fact_texts_and_declension) {
  World w;
  w.run_until(20.5);
  echo::SpeechRequest r = req_for("mira", "evidence", "inspect", "concerned", "sensor_a", "nika");
  r.kind = "evidence";
  r.fact_ids = {"pressure_disagreement", "sensor_a_drop"};
  const echo::Speech s = echo::render_speech(w.core(), r);
  CHECK(s.text.find("механический манометр там же стабилен") != std::string::npos);
  CHECK(s.text.find("до 92 кПа") != std::string::npos);
  CHECK_EQ(s.kind, std::string("evidence"));
  // Slots are declined: accusative niche, instrumental companion.
  const auto& names = w.core().data.speech.names;
  CHECK_EQ(names.at("niche_a").acc, std::string("нишу A"));
  CHECK_EQ(names.at("nika").ins, std::string("Никой"));
  const echo::Speech p = echo::render_speech(w.core(), req_for("thomas", "propose", "inspect", "neutral", "niche_a", "samir"));
  CHECK_MSG(p.text.find("нишу A") != std::string::npos || p.text.find("нише A") != std::string::npos, p.text);
}

TEST(speech, data_validation_rejects_bad_templates) {
  Value data = d0_data();
  Value& templates = *data.find_mut("speech")->find_mut("templates");
  Value bad = Value::object();
  bad.set("id", "x.bad");
  bad.set("kind", "line");
  bad.set("stage", "say");
  bad.set("text", "Код: {secret_code}");
  templates.push(bad);
  echo::Engine e;
  Value no_data = Value::object();
  no_data.set("cmd", "init");
  const Value r = parse_or_die(e.call(echo::json::dump(no_data)));
  CHECK_EQ(r["error"]["code"].str(), std::string("invalid_argument"));
  Value init = Value::object();
  init.set("cmd", "init");
  init.set("data", data);
  const Value r2 = parse_or_die(e.call(echo::json::dump(init)));
  CHECK_EQ(r2["error"]["code"].str(), std::string("data_invalid"));
  CHECK(r2["error"]["message"].str().find("secret_code") != std::string::npos);
}
