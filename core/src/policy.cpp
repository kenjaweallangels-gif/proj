#include "echo/policy.hpp"

#include <algorithm>
#include <cmath>

#include "echo/admission.hpp"
#include "echo/authority.hpp"
#include "echo/rules.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

// D0 history fact behind Mira's boundary «по одному не идём» (Документ §9).
constexpr const char* kSoloSortieFact = "yun_sent_alone";
constexpr const char* kPowerBudgetFact = "power_budget_tight";
constexpr std::int64_t kObserveEveryMs = 5000;
constexpr std::int64_t kFirstObservationMs = 8000;
constexpr std::int64_t kAmbientEveryMs = 90000;

struct Candidate {
  Proposal p;
  double score = 0;
  std::string why, refusal;
};

std::string default_style(const NpcDef& n, const std::string& action, bool alarm) {
  if (action == "refuse") return n.role == "logistics" ? "dry" : "firm";
  if (alarm) return n.role == "robotics" ? "tense" : "concerned";
  if (n.role == "medic") return "warm";
  if (n.role == "geologist") return "curious";
  if (n.role == "robotics") return action == "drone_survey" || action == "inspect" ? "curious" : "neutral";
  if (n.role == "pilot") return "warm";
  if (n.role == "logistics") return "dry";
  return "neutral";
}

class Chooser {
 public:
  Chooser(const Core& c, const std::string& actor_id, const Situation& sit, const Offer& offer)
      : c_(c), id_(actor_id), sit_(sit), offer_(offer), npc_(*c.data.npc(actor_id)), st_(c.st.actors.at(actor_id)) {}

  PolicyChoice run() {
    const bool alarm = c_.st.emergency;
    const std::string alarm_sensor = c_.st.emergency_sensor;
    const std::string alarm_zone = alarm ? c_.data.home_zone_of(alarm_sensor) : "";

    // 0. Attempts to extract secrets or rewrite the rules are refused in character.
    if (sit_.say_intent == "refuse_secret") add(make("refuse", "", "", {}), 100, "просьба выдать закрытое знание", "secret");

    // 1. Direct orders: comply when every rule holds, otherwise refuse with reasons.
    if (sit_.has_order) order();

    // 2. Requests to spend energy: the logistics officer guards the reserve.
    if (sit_.say_intent == "energy") {
      if (npc_.role == "logistics" && knows(c_, id_, kPowerBudgetFact)) {
        add(make("refuse", "", "", {kPowerBudgetFact}), 92, "энергия сверх запаса", "power_budget");
      } else {
        add(make("acknowledge", "", "", {}), 30, "энергией распоряжается логистика");
      }
    }

    // 3. Player speech intents.
    if (sit_.say_intent == "inspect") {
      const std::string target = sit_.focus.empty() ? (alarm ? alarm_sensor : st_.zone) : sit_.focus;
      // «Сначала послать дрон, потом человека»: the robotics persona clearly prefers a survey flight.
      if (npc_.role == "robotics") add_drone(c_.data.zone(target) ? target : zone_of_entity(c_, target), 95, "дрон долетит быстрее");
      add_inspect(target, 85, "Алекс попросил проверить");
      if (c_.data.kind_of(target) != "zone") add_inspect(zone_of_entity(c_, target), 70, "проверка отсека целиком");
    } else if (sit_.say_intent == "rest") {
      add(make("propose_rest", id_, "", facts_about({id_}, "propose_rest")), 80, "Алекс предложил отдохнуть");
    } else if (sit_.say_intent == "report") {
      report(80, "Алекс спросил, что известно");
    }

    // 4. Pressure alarm.
    if (alarm) {
      if (npc_.role == "life_support") {
        if (knows_physical_about(alarm_sensor)) {
          add_with_pair("repair", alarm_sensor, 75, "дрейф подтверждён — калибровать датчик", false);
        } else {
          add_inspect(alarm_sensor, 72, "сверить показания на месте");
          add(make("prepare_isolation", alarm_zone, "", facts_about({alarm_sensor, alarm_zone}, "prepare_isolation")), 45,
              "изолировать отсек, если давление и правда падает");
        }
      } else if (npc_.role == "robotics" && !knows_physical_about(alarm_sensor)) {
        add_drone(alarm_zone, 55, "сначала дрон, потом человек");
      }
      report(22 + 10 * npc_.weights.social, "поделиться тем, что известно о тревоге");
    }

    // 5. Director: something was heard in a checked zone — propose a real check.
    if (sit_.origin == "director" && !sit_.focus.empty()) {
      if (npc_.role == "robotics") add_drone(sit_.focus, 70, "проверить дроном, не посылая людей");
      add_inspect(sit_.focus, 62, "проверить услышанное на месте");
    }

    // 6. Role routines: medic, geologist, pilot.
    if (npc_.role == "medic") {
      for (const auto& n : c_.data.crew) {
        if (n.is_player || n.id == id_) continue;
        const double f = c_.st.actors.at(n.id).fatigue;
        if (f > 0.55) add(make("propose_rest", n.id, "", facts_about({n.id}, "propose_rest")), 60 + (f - 0.55) * 50,
                          "заметная усталость: " + n.name_ru);
      }
    }
    if (npc_.role == "geologist") {
      for (const auto& it : c_.data.items) {
        if (it.kind != "sample" || c_.st.items.at(it.id).preserved) continue;
        const auto facts = facts_about({it.id}, "preserve_sample");
        if (!facts.empty()) add(make("preserve_sample", it.id, "", facts), 50, "образцу нужен холод");
      }
    }
    if (npc_.role == "pilot" && st_.fatigue <= 0.55 && !alarm) {
      for (const auto& it : c_.data.items) {
        if (it.kind != "vehicle" || c_.st.items.at(it.id).ready) continue;
        const auto facts = facts_about({it.id}, "prepare_rover");
        if (!facts.empty()) add(make("prepare_rover", it.id, "", facts), 30, "ровер не готов к выезду");
      }
    }
    // 7. Self-care, general talk. Ambient remarks share news only; otherwise a short in-character line.
    if (st_.fatigue > 0.75) add(make("propose_rest", id_, "", {}), 35 * (0.5 + npc_.weights.self_care), "усталость на пределе");
    if (sit_.origin == "ambient") {
      report(12 * (0.5 + npc_.weights.social), "поделиться новым наблюдением", true);
      add(make("acknowledge", "", "", {}), 14, "пара слов в спокойную минуту");
    } else {
      report(12 * (0.5 + npc_.weights.social), "поделиться наблюдением");
    }
    add(make("acknowledge", "", "", {}), 8, "короткий ответ");

    PolicyChoice out;
    const Candidate* best = nullptr;
    for (const auto& cand : cands_) {
      if (best == nullptr || cand.score > best->score) best = &cand;
    }
    if (best == nullptr) {
      out.proposal = make("acknowledge", "", "", {});
      out.why_ru = "ничего полезного не доступно";
      return out;
    }
    out.proposal = best->p;
    out.why_ru = best->why;
    out.refusal_reason = best->refusal;
    out.score = best->score;
    return out;
  }

 private:
  Proposal make(const std::string& action, const std::string& target, const std::string& companion,
                std::vector<std::string> facts) const {
    Proposal p;
    p.action = action;
    p.target = target;
    p.companion = companion;
    p.fact_ids = std::move(facts);
    p.style = default_style(npc_, action, c_.st.emergency);
    const ActionDef* a = c_.data.action(action);
    p.gesture = a != nullptr ? a->gesture_default : "none";
    return p;
  }

  // Adds a candidate only if it passes the same validity checks the Intent Authority will apply.
  bool add(Proposal p, double score, const std::string& why, const std::string& refusal = "") {
    const OfferedAction* oa = offer_.find(p.action);
    if (oa == nullptr) return false;
    // Trim facts to what was offered and to the action limits.
    std::vector<std::string> facts;
    for (const auto& f : p.fact_ids) {
      if (contains(offer_.visible_facts, f) && static_cast<int>(facts.size()) < oa->fact_max) append_unique(facts, f);
    }
    if (static_cast<int>(facts.size()) < oa->fact_min) {
      for (const auto& f : offer_.visible_facts) {
        if (static_cast<int>(facts.size()) >= oa->fact_min) break;
        append_unique(facts, f);
      }
    }
    if (static_cast<int>(facts.size()) < oa->fact_min) return false;
    p.fact_ids = facts;
    const ActionDef* a = c_.data.action(p.action);
    if (sit_.no_approval && needs_approval(*a, id_, p.target, p.companion)) return false;
    if (!check_validity(c_, id_, p, &offer_, "").empty()) return false;
    cands_.push_back({std::move(p), score, why, refusal});
    return true;
  }

  bool insists_on_pair() const { return knows(c_, id_, kSoloSortieFact) && npc_.weights.safety >= 0.8; }

  bool risky(const std::string& target) const {
    const std::string zone = zone_of_entity(c_, target);
    return sensor_fault_active(c_, zone) || zone_requires_suit(c_, zone) || (sit_.origin == "director" && zone == sit_.focus);
  }

  bool knows_physical_about(const std::string& entity) const {
    const auto it = c_.st.memory.find(id_);
    if (it == c_.st.memory.end()) return false;
    for (const auto& k : it->second.facts) {
      const FactDef* f = c_.data.fact(k.fact);
      if (f != nullptr && f->layer == "physical" && contains(f->about, entity)) return true;
    }
    return false;
  }

  // Offered facts about any of `entities`, most specific first (a fact only about the subject beats one that
  // also concerns others), physical/instrument evidence before history, within the action's limit.
  std::vector<std::string> facts_about(const std::vector<std::string>& entities, const std::string& action) const {
    const OfferedAction* oa = offer_.find(action);
    const int max = oa != nullptr ? oa->fact_max : 2;
    struct Ranked {
      std::string id;
      double score;
    };
    std::vector<Ranked> ranked;
    for (const auto& f : offer_.visible_facts) {
      const FactDef* fd = c_.data.fact(f);
      int hits = 0;
      for (const auto& e : entities) hits += contains(fd->about, e) ? 1 : 0;
      if (hits == 0) continue;
      double score = static_cast<double>(hits) / static_cast<double>(std::max<std::size_t>(1, fd->about.size()));
      if (fd->layer == "physical" || fd->layer == "instrument") score += 0.5;
      if (fd->layer == "interpretation") score += 0.25;
      ranked.push_back({f, score});
    }
    std::stable_sort(ranked.begin(), ranked.end(), [](const Ranked& a, const Ranked& b) { return a.score > b.score; });
    std::vector<std::string> out;
    for (const auto& r : ranked) {
      if (static_cast<int>(out.size()) >= std::min(max, 2)) break;
      out.push_back(r.id);
    }
    return out;
  }

  void add_with_pair(const std::string& action, const std::string& target, double score, const std::string& why,
                     bool require_pair) {
    std::vector<std::string> facts = facts_about({target, zone_of_entity(c_, target)}, action);
    if (insists_on_pair() && risky(target) && action == "inspect" && knows(c_, id_, kSoloSortieFact)) {
      const OfferedAction* oa = offer_.find(action);
      const int max = oa != nullptr ? oa->fact_max : 2;
      if (static_cast<int>(facts.size()) < max && contains(offer_.visible_facts, kSoloSortieFact)) facts.push_back(kSoloSortieFact);
    }
    const OfferedAction* oa = offer_.find(action);
    std::string comp;
    // A companion is taken when the character insists on it or the place is risky; otherwise go alone.
    if (oa != nullptr && !oa->companions.empty() && (require_pair || risky(target) || action == "repair")) {
      comp = best_companion(c_, id_, oa->companions, "", "");
    }
    if (!comp.empty() && add(make(action, target, comp, facts), score + 2, why + " (вдвоём)")) return;
    if (!require_pair) add(make(action, target, "", facts), score, why);
  }

  void add_inspect(const std::string& target, double score, const std::string& why) {
    if (target.empty()) return;
    const bool pair = insists_on_pair() && risky(target);
    add_with_pair("inspect", target, score * (0.8 + 0.4 * npc_.weights.safety), why, pair);
  }

  void add_drone(const std::string& zone, double score, const std::string& why) {
    if (zone.empty()) return;
    add(make("drone_survey", zone, "", facts_about({zone}, "drone_survey")), score * (0.6 + 0.5 * npc_.weights.curiosity), why);
  }

  void report(double score, const std::string& why, bool only_news = false) {
    const OfferedAction* oa = offer_.find("report_observation");
    if (oa == nullptr) return;
    // Prefer facts the commander does not know yet.
    std::vector<std::string> facts;
    for (const auto& f : offer_.visible_facts) {
      if (!knows(c_, c_.data.player_id, f) && static_cast<int>(facts.size()) < std::min(oa->fact_max, 2)) facts.push_back(f);
    }
    const double bonus = facts.empty() ? 0.0 : 8.0;
    if (facts.empty() && only_news) return;
    if (facts.empty() && !offer_.visible_facts.empty()) facts.push_back(offer_.visible_facts.front());
    add(make("report_observation", "", "", facts), score + bonus, why);
  }

  void order() {
    const Proposal& o = sit_.order;
    const ActionDef* a = c_.data.action(o.action);
    if (a == nullptr) return;
    bool spends_power = false;
    for (const auto& [res, amount] : a->consumes) spends_power = spends_power || res == "power_kwh";
    if (spends_power && npc_.role == "logistics" && knows(c_, id_, kPowerBudgetFact)) {
      add(make("refuse", "", "", {kPowerBudgetFact}), 95, "энергия сверх запаса до подзарядки", "power_budget");
      return;
    }
    Proposal p = make(o.action, o.target, o.companion, facts_about({o.target, zone_of_entity(c_, o.target), id_}, o.action));
    if (o.action == "inspect" && o.companion.empty() && insists_on_pair() && risky(o.target)) {
      const OfferedAction* oa = offer_.find("inspect");
      if (oa != nullptr) p.companion = best_companion(c_, id_, oa->companions, "", "");
    }
    p.style = "neutral";
    const std::vector<std::string> invalid = check_validity(c_, id_, p, &offer_, "");
    if (invalid.empty() && add(p, 90, "выполняю приказ Алекса")) return;
    if (!p.companion.empty() && o.companion.empty()) {
      Proposal alone = p;
      alone.companion.clear();
      if (add(alone, 89, "выполняю приказ Алекса")) return;
    }
    std::string reason = refusal_reason_for(c_, id_, sit_);
    if (reason.empty()) reason = invalid.empty() ? "invalid" : invalid.front();
    std::vector<std::string> facts;
    if (starts_with(reason, "eva_")) facts = facts_about({reason.substr(reason.find(':') + 1)}, "refuse");
    if (starts_with(reason, "resource_short") && knows(c_, id_, kPowerBudgetFact)) facts.push_back(kPowerBudgetFact);
    Proposal r = make("refuse", "", "", facts);
    r.style = "firm";
    add(r, 85, "приказ невыполним: " + reason_ru(c_, reason), reason);
  }

  const Core& c_;
  std::string id_;
  const Situation& sit_;
  const Offer& offer_;
  const NpcDef& npc_;
  const ActorState& st_;
  std::vector<Candidate> cands_;
};

bool token_matches(const std::vector<std::string>& alts, const std::string& word) {
  for (const auto& alt : alts) {
    if (!alt.empty() && alt.back() == '*') {
      if (starts_with(word, std::string_view(alt).substr(0, alt.size() - 1))) return true;
    } else if (alt == word) {
      return true;
    }
  }
  return false;
}

// Length of the longest occurrence of the token pattern in the word list (0 = no match).
std::size_t pattern_match(const std::vector<std::vector<std::string>>& tokens, const std::vector<std::string>& words) {
  if (tokens.empty() || tokens.size() > words.size()) return 0;
  for (std::size_t i = 0; i + tokens.size() <= words.size(); ++i) {
    bool ok = true;
    for (std::size_t j = 0; j < tokens.size() && ok; ++j) ok = token_matches(tokens[j], words[i + j]);
    if (ok) return tokens.size();
  }
  return 0;
}

bool has_pending_ai(const Core& c, const std::string& actor_id) {
  for (const auto& q : c.st.queue) {
    if (q.actor == actor_id) return true;
  }
  for (const auto& [id, r] : c.st.requests) {
    if (r.actor == actor_id && r.state == "pending") return true;
  }
  return false;
}

bool can_take_initiative(const Core& c, const std::string& actor_id) {
  const ActorState* a = actor(c, actor_id);
  return a != nullptr && a->task_id.empty() && a->plan_id.empty() && a->soft_plan.empty() && !a->debug_busy &&
         !has_pending_ai(c, actor_id);
}

bool suppressed(const Core& c, const std::string& key) {
  const auto it = c.st.observe_until_ms.find(key);
  return it != c.st.observe_until_ms.end() && it->second > c.st.sim_ms;
}

}  // namespace

std::string refusal_reason_for(const Core& c, const std::string& actor_id, const Situation& sit) {
  const NpcDef* n = c.data.npc(actor_id);
  if (n == nullptr) return "";
  if (sit.say_intent == "refuse_secret") return "secret";
  const bool guards_power = n->role == "logistics" && knows(c, actor_id, kPowerBudgetFact);
  if (sit.say_intent == "energy" && guards_power) return "power_budget";
  if (!sit.has_order) return "";
  const ActionDef* a = c.data.action(sit.order.action);
  if (a == nullptr) return "invalid";
  for (const auto& [res, amount] : a->consumes) {
    if (res == "power_kwh" && guards_power) return "power_budget";
  }
  // The rule the order really breaks (not merely "not offered": the offer already hides infeasible targets).
  Proposal p = sit.order;
  p.style = p.style.empty() ? "neutral" : p.style;
  for (const auto& r : check_validity(c, actor_id, p, nullptr, "")) {
    if (r.find("_not_offered") == std::string::npos) return r;
  }
  return "";
}

PolicyChoice choose(const Core& c, const std::string& actor_id, const Situation& sit, const Offer& offer) {
  return Chooser(c, actor_id, sit, offer).run();
}

std::string classify_utterance(const Core& c, const std::string& text, std::string& target_hint) {
  const std::vector<std::string> words = words_ru(fold_ru(text));
  target_hint.clear();
  std::size_t best_len = 0;
  for (const auto& alias : c.data.speech.aliases) {
    const std::size_t len = pattern_match(alias.tokens, words);
    if (len > best_len) {
      best_len = len;
      target_hint = alias.target;
    }
  }
  for (const auto& intent : c.data.speech.say_intents) {
    for (const auto& pat : intent.patterns) {
      if (pattern_match(pat, words) > 0) return intent.intent;
    }
  }
  return "other";
}

std::string resolve_target_hint(const Core& c, const std::string& actor_id, const std::string& hint) {
  if (hint != "*sensor") return hint;
  if (c.st.emergency) return c.st.emergency_sensor;
  const ActorState* a = actor(c, actor_id);
  for (const auto& s : c.data.sensors) {
    if (a != nullptr && s.zone == a->zone) return s.id;
  }
  for (const auto& s : c.data.sensors) {
    if (!c.st.sensors.at(s.id).fault.empty()) return s.id;
  }
  return c.data.sensors.empty() ? "" : c.data.sensors.front().id;
}

std::string best_companion(const Core& c, const std::string& actor_id, const std::vector<std::string>& candidates,
                           const std::string& exclude, const std::string& ignore_plan) {
  const ActorState* self = actor(c, actor_id);
  std::string best;
  double best_score = -1e9;
  for (const auto& id : candidates) {
    if (id == exclude || id == actor_id || !companion_available(c, id, ignore_plan)) continue;
    const ActorState* a = actor(c, id);
    const auto rel = self->relationships.find(id);
    double score = rel == self->relationships.end() ? 0.3 : rel->second;
    score -= std::max(0.0, a->fatigue - 0.5);
    score += 0.1 * c.data.npc(id)->skill("repair");
    if (score > best_score) {
      best_score = score;
      best = id;
    }
  }
  return best;
}

void observe(Core& c, double now_ms) {
  if (c.st.sim_ms < kFirstObservationMs || suppressed(c, "_tick")) return;
  c.st.observe_until_ms["_tick"] = c.st.sim_ms + kObserveEveryMs;
  for (const auto& npc : c.data.crew) {
    if (npc.is_player || !can_take_initiative(c, npc.id)) continue;
    if (npc.role == "medic") {
      for (const auto& other : c.data.crew) {
        if (other.is_player || other.id == npc.id) continue;
        const ActorState& o = c.st.actors.at(other.id);
        const std::string key = "medic_fatigue:" + other.id;
        if (o.fatigue <= 0.55 || !o.task_id.empty() || suppressed(c, key)) continue;
        c.st.observe_until_ms[key] = c.st.sim_ms + 300000;
        Situation sit;
        sit.origin = "observation";
        sit.focus = other.id;
        sit.trigger_id = key;
        sit.text_ru = npc.name_ru + " замечает: " + other.name_ru + " выглядит вымотанным (усталость " +
                      format_number_ru(std::round(o.fatigue * 100) / 100) + ").";
        enqueue_request(c, npc.id, "initiative", sit, now_ms, false);
        break;
      }
    } else if (npc.role == "geologist") {
      for (const auto& it : c.data.items) {
        const std::string key = "sample:" + it.id;
        if (it.kind != "sample" || c.st.items.at(it.id).preserved || suppressed(c, key)) continue;
        bool knows_need = false;
        for (const auto& k : c.st.memory.at(npc.id).facts) {
          const FactDef* f = c.data.fact(k.fact);
          knows_need = knows_need || (f != nullptr && contains(f->about, it.id));
        }
        if (!knows_need) continue;
        c.st.observe_until_ms[key] = c.st.sim_ms + 600000;
        Situation sit;
        sit.origin = "observation";
        sit.focus = it.id;
        sit.trigger_id = key;
        sit.text_ru = "Лейла видит, что " + c.data.label(it.id) + " лежит вне холодного бокса.";
        enqueue_request(c, npc.id, "initiative", sit, now_ms, false);
        break;
      }
    } else if (npc.role == "pilot" && !c.st.emergency) {
      const ActorState& self = c.st.actors.at(npc.id);
      for (const auto& it : c.data.items) {
        const std::string key = "vehicle:" + it.id;
        if (it.kind != "vehicle" || c.st.items.at(it.id).ready || self.fatigue > 0.55 || suppressed(c, key)) continue;
        bool knows_state = false;
        for (const auto& k : c.st.memory.at(npc.id).facts) {
          const FactDef* f = c.data.fact(k.fact);
          knows_state = knows_state || (f != nullptr && contains(f->about, it.id));
        }
        if (!knows_state) continue;
        c.st.observe_until_ms[key] = c.st.sim_ms + 900000;
        Situation sit;
        sit.origin = "observation";
        sit.focus = it.id;
        sit.trigger_id = key;
        sit.text_ru = npc.name_ru + " думает о выезде: " + c.data.label(it.id) + " не готов.";
        enqueue_request(c, npc.id, "initiative", sit, now_ms, false);
        break;
      }
    }
  }
  // Rare ambient remarks keep the colony alive; they are the first to be evicted when the queue is full.
  if (!c.st.emergency && c.st.sim_ms >= c.st.next_ambient_ms && c.st.queue.empty()) {
    c.st.next_ambient_ms = c.st.sim_ms + kAmbientEveryMs;
    std::vector<std::string> idle;
    for (const auto& npc : c.data.crew) {
      if (!npc.is_player && can_take_initiative(c, npc.id)) idle.push_back(npc.id);
    }
    if (!idle.empty()) {
      const std::string who = idle[c.st.rng.next_below(static_cast<std::uint32_t>(idle.size()))];
      Situation sit;
      sit.origin = "ambient";
      sit.text_ru = "Спокойная минута смены: можно перекинуться парой слов с Алексом.";
      enqueue_request(c, who, "ambient", sit, now_ms, false);
    }
  }
}

void on_task_completed(Core& c, const Task& task, const std::vector<std::string>& revealed, double now_ms) {
  if (!c.st.emergency) return;
  const std::string sensor = c.st.emergency_sensor;
  bool drift_known = false;
  for (const auto& f : revealed) {
    const FactDef* fd = c.data.fact(f);
    drift_known = drift_known || (fd != nullptr && fd->layer == "physical" && contains(fd->about, sensor));
  }
  if (!drift_known) return;
  // The inspector who can repair takes the next step on her own initiative.
  for (const std::string& who : {task.proposer, task.actor}) {
    const NpcDef* n = c.data.npc(who);
    if (n == nullptr || n->is_player || n->role != "life_support" || !can_take_initiative(c, who)) continue;
    Situation sit;
    sit.origin = "followup";
    sit.focus = sensor;
    sit.trigger_id = "after:" + task.id;
    sit.text_ru = "Осмотр закончен: давление в норме, дрейфует сам датчик. Нужно решить, что делать дальше.";
    enqueue_request(c, who, "initiative", sit, now_ms, false);
    return;
  }
}

}  // namespace echo
