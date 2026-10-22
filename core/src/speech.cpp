#include "echo/speech.hpp"

#include <algorithm>

#include "echo/world.hpp"

namespace echo {
namespace {

struct Candidate {
  const SpeechTemplate* t = nullptr;
  int score = 0;
};

// Facts that may be spoken: known to the speaker, not protected, offered in the request (when given).
std::vector<std::string> usable_facts(const Core& c, const SpeechRequest& req) {
  std::vector<std::string> out;
  for (const auto& f : req.fact_ids) {
    const FactDef* fd = c.data.fact(f);
    if (fd == nullptr || fd->is_protected) continue;
    if (!knows(c, req.actor, f)) continue;
    if (req.allowed_facts != nullptr && !contains(*req.allowed_facts, f)) continue;
    append_unique(out, f);
  }
  return out;
}

bool conditions_hold(const Core& c, const SpeechTemplate& t, const SpeechRequest& req, bool have_fact, int& matched) {
  matched = 0;
  auto check = [&](bool cond) {
    if (cond) ++matched;
    return cond;
  };
  if (!t.when_known_fact.empty() && !check(knows(c, req.actor, t.when_known_fact))) return false;
  if (!t.when_situation.empty() && !check(t.when_situation == req.situation)) return false;
  if (!t.when_target_kind.empty() && !check(c.data.kind_of(req.target) == t.when_target_kind)) return false;
  if (!t.when_target.empty() && !check(t.when_target == req.target)) return false;
  if (!t.when_result_fact.empty() && !check(t.when_result_fact == req.result_fact)) return false;
  if (!t.when_reason.empty() && !check(t.when_reason == req.reason)) return false;
  if (!t.when_say_intent.empty() && !check(t.when_say_intent == req.say_intent)) return false;
  if (t.when_companion >= 0 && !check((t.when_companion == 1) == !req.companion.empty())) return false;
  if (t.when_target_self >= 0 && !check(!req.target.empty() && (t.when_target_self == 1) == (req.target == req.actor))) {
    return false;
  }
  if (t.needs_target && req.target.empty()) return false;
  if (t.needs_companion && req.companion.empty()) return false;
  if (t.needs_fact && !have_fact) return false;
  return true;
}

std::vector<Candidate> collect(const Core& c, const SpeechRequest& req, const std::string& kind, bool have_fact) {
  std::vector<Candidate> out;
  for (const auto& t : c.data.speech.templates) {
    if (t.kind != kind || t.stage != req.stage) continue;
    if (!t.action.empty() && t.action != req.action) continue;
    if (!t.actors.empty() && !contains(t.actors, req.actor)) continue;
    int matched = 0;
    if (!conditions_hold(c, t, req, have_fact, matched)) continue;
    int score = matched * 3;
    if (!t.action.empty()) score += 4;
    if (!t.actors.empty()) score += 4;
    if (!t.styles.empty()) score += contains(t.styles, req.style) ? 2 : -2;
    if (t.needs_fact) score += 1;
    out.push_back({&t, score});
  }
  return out;
}

std::string name_form(const Core& c, const std::string& id, const std::string& form) {
  const auto it = c.data.speech.names.find(id);
  if (it != c.data.speech.names.end()) return it->second.form(form);
  return c.data.label(id);
}

std::string fill(const Core& c, const SpeechTemplate& t, const SpeechRequest& req, const std::vector<std::string>& facts,
                 std::vector<std::string>& used_facts) {
  std::string out;
  const std::string& s = t.text;
  std::size_t i = 0;
  while (i < s.size()) {
    if (s[i] != '{') {
      out.push_back(s[i++]);
      continue;
    }
    const std::size_t end = s.find('}', i);
    const std::string slot = s.substr(i + 1, end - i - 1);
    i = end + 1;
    const std::size_t dot = slot.find('.');
    const std::string base = slot.substr(0, dot);
    const std::string form = dot == std::string::npos ? "nom" : slot.substr(dot + 1);
    if (base == "target") out += name_form(c, req.target, form);
    else if (base == "companion") out += name_form(c, req.companion, form);
    else if (base == "player") out += name_form(c, c.data.player_id, form);
    else if (base == "actor") out += name_form(c, req.actor, form);
    else if (base == "fact" && !facts.empty()) {
      out += c.data.fact(facts.front())->text_ru;
      append_unique(used_facts, facts.front());
    } else if (base == "facts") {
      std::vector<std::string> texts;
      for (const auto& f : facts) {
        texts.push_back(c.data.fact(f)->text_ru);
        append_unique(used_facts, f);
      }
      out += join(texts, " ");
    }
  }
  // Collapse accidental double spaces left by empty substitutions.
  std::string clean;
  for (const char ch : out) {
    if (ch == ' ' && !clean.empty() && clean.back() == ' ') continue;
    clean.push_back(ch);
  }
  while (!clean.empty() && clean.back() == ' ') clean.pop_back();
  return clean;
}

}  // namespace

std::string speech_situation(const Core& c, const Situation& sit) {
  if (sit.origin == "director") return "echo";
  if (sit.origin == "player_order") return "order";
  if (c.st.emergency) return "alarm";
  if (sit.origin == "player_say") return "say";
  if (sit.origin == "trigger" || sit.origin == "observation" || sit.origin == "followup") return "initiative";
  return "calm";
}

Speech render_speech(Core& c, const SpeechRequest& req) {
  const std::vector<std::string> facts = usable_facts(c, req);
  std::vector<Candidate> cands = collect(c, req, req.kind, !facts.empty());
  std::string kind = req.kind;
  if (cands.empty() && req.kind == "fallback") {
    cands = collect(c, req, "line", !facts.empty());  // fallback reuses ordinary lines of the same stage
  }
  Speech sp;
  sp.actor = req.actor;
  sp.kind = kind;
  sp.style = req.style.empty() ? "neutral" : req.style;
  const ActionDef* action = c.data.action(req.action);
  if (cands.empty()) {
    sp.text = "Принято.";
    sp.template_id = "core.minimal";
    sp.gesture = req.gesture.empty() ? "nod" : req.gesture;
    return sp;
  }
  std::stable_sort(cands.begin(), cands.end(), [](const Candidate& a, const Candidate& b) { return a.score > b.score; });
  const auto& recent = c.st.speech_recent[req.actor];
  auto is_recent = [&](const SpeechTemplate* t) { return std::find(recent.begin(), recent.end(), t->id) != recent.end(); };
  // Walk score tiers from the most specific; inside a tier prefer lines the speaker has not used recently.
  std::vector<const SpeechTemplate*> pool;
  std::size_t i = 0;
  while (i < cands.size() && pool.empty()) {
    const int tier = cands[i].score;
    std::vector<const SpeechTemplate*> tier_all;
    for (; i < cands.size() && cands[i].score == tier; ++i) tier_all.push_back(cands[i].t);
    for (const auto* t : tier_all) {
      if (!is_recent(t)) pool.push_back(t);
    }
  }
  if (pool.empty()) {
    // Everything was used recently: take the least recently used among the best tier.
    const SpeechTemplate* best = cands.front().t;
    std::size_t best_pos = recent.size();
    for (const auto& cand : cands) {
      if (cand.score != cands.front().score) break;
      const auto it = std::find(recent.begin(), recent.end(), cand.t->id);
      const std::size_t pos = static_cast<std::size_t>(it - recent.begin());
      if (pos < best_pos) {
        best_pos = pos;
        best = cand.t;
      }
    }
    pool.push_back(best);
  }
  const SpeechTemplate* chosen = pool[c.st.rng.next_below(static_cast<std::uint32_t>(pool.size()))];
  sp.template_id = chosen->id;
  sp.text = fill(c, *chosen, req, facts, sp.fact_ids);
  if (!req.gesture.empty() && req.gesture != "none") sp.gesture = req.gesture;
  else if (!chosen->gesture.empty()) sp.gesture = chosen->gesture;
  else sp.gesture = action != nullptr ? action->gesture_default : "none";
  return sp;
}

void say(Core& c, const Speech& s, const std::string& source) {
  auto& recent = c.st.speech_recent[s.actor];
  const bool repeated = std::find(recent.begin(), recent.end(), s.template_id) != recent.end();
  recent.push_back(s.template_id);
  while (static_cast<int>(recent.size()) > std::max(1, c.data.speech.anti_repeat_window)) recent.pop_front();
  c.rt.ai.speech_lines++;
  if (repeated) c.rt.ai.speech_repeated++;
  c.rt.ai.speech_by_kind[s.kind]++;
  if (ActorState* a = actor(c, s.actor)) {
    a->gesture = s.gesture;
    a->style = s.style;
    const auto talk_ms = static_cast<std::int64_t>(1500 + 55 * utf8_length(s.text));
    a->talking_until_ms = c.st.sim_ms + std::min<std::int64_t>(talk_ms, 8000);
  }
  if (contains_protected_text(c, s.text)) {
    c.rt.ai.violations_admitted++;
    c.rt.ai.violation_log.push_back("protected text in speech " + s.template_id);
  }
  emit(c, "speech", s.actor, speech_json(s), source);
}

json::Value speech_json(const Speech& s) {
  json::Value v = json::Value::object();
  v.set("actor", s.actor);
  v.set("text", s.text);
  v.set("style", s.style);
  v.set("gesture", s.gesture);
  v.set("fact_ids", json::Value::string_array(s.fact_ids));
  v.set("template_id", s.template_id);
  v.set("kind", s.kind);
  return v;
}

bool contains_protected_text(const Core& c, const std::string& text) {
  for (const auto& f : c.data.facts) {
    if (f.is_protected && !f.text_ru.empty() && text.find(f.text_ru) != std::string::npos) return true;
  }
  return false;
}

}  // namespace echo
