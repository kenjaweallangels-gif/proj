#include "echo/context.hpp"

#include <algorithm>
#include <cmath>

#include "echo/rules.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

constexpr std::size_t kMaxTargetsPerAction = 4;
constexpr std::size_t kMaxCompanions = 3;
constexpr std::size_t kMaxVisibleFacts = 24;
constexpr std::size_t kMaxMemoryExcerpt = 16;
constexpr std::size_t kMaxRecentEvents = 6;
constexpr std::int64_t kRecentlyLearnedMs = 300000;

int layer_max(const Core& c, const char* layer) {
  const auto& lt = c.data.profiles.admission.layer_tokens;
  const auto it = lt.find(layer);
  return it == lt.end() ? 250 : it->second.second;
}

std::string fatigue_word(double f) {
  if (f > 0.7) return "высокая";
  if (f > 0.5) return "заметная";
  return "низкая";
}

int target_relevance(const Core& c, const std::string& actor_id, const Situation& sit,
                     const std::vector<std::string>& ents, const std::string& target) {
  int score = 0;
  if (sit.has_order && target == sit.order.target) score += 6;
  if (!sit.focus.empty() && target == sit.focus) score += 5;
  if (contains(ents, target)) score += 3;
  if (c.st.sensors.count(target) != 0 && !c.st.sensors.at(target).fault.empty()) score += 3;
  if (c.data.zone(target) != nullptr && sensor_fault_active(c, target)) score += 2;
  if (const ActorState* a = actor(c, target)) {
    if (a->fatigue > 0.55) score += 2;
  }
  const ActorState* self = actor(c, actor_id);
  if (self != nullptr && zone_of_entity(c, target) == self->zone) score += 1;
  if (const auto it = c.st.items.find(target); it != c.st.items.end()) {
    if (c.data.item(target)->kind == "sample" && !it->second.preserved) score += 1;
  }
  return score;
}

struct Layers {
  std::string role, situation;
  std::vector<std::string> knowledge, recent, relations;
  std::string format;
};

std::string render_format(const Core& c, const Offer& offer) {
  std::string out;
  for (const auto& a : offer.actions) {
    const ActionDef* def = c.data.action(a.id);
    std::vector<std::string> t, comp;
    for (const auto& x : a.targets) t.push_back(x + " (" + c.data.label(x) + ")");
    for (const auto& x : a.companions) comp.push_back(x + " (" + c.data.label(x) + ")");
    out += "- " + a.id + ": " + (def ? def->label_ru : a.id) + "\n  цели: " + (t.empty() ? "без цели" : join(t, ", ")) +
           "\n  напарники: " + (comp.empty() ? "нет" : join(comp, ", ")) + "\n  фактов: " + std::to_string(a.fact_min) +
           ".." + std::to_string(a.fact_max) + "\n";
  }
  out += "Стили: " + join(c.data.styles, ", ") + ". Жесты: " + join(c.data.gestures, ", ") + ".";
  return out;
}

int lines_tokens(const std::vector<std::string>& lines) {
  std::string all;
  for (const auto& l : lines) all += l + "\n";
  return estimate_tokens(all);
}

std::string memory_line(const MemoryEntry& m) {
  static const std::map<std::string, std::string> kKind = {
      {"fact", "факт"}, {"opinion", "мнение"}, {"promise", "обещание"}, {"episode", "эпизод"}};
  const std::string conf = m.confidence >= 0 ? ", уверенность " + fixed(m.confidence, 1) : std::string();
  return "- [" + kKind.at(m.kind) + conf + "] " + m.text_ru + " (" + m.source + ")";
}

std::string situation_text(const Core& c, const QueueItem& item) {
  const std::string& id = item.actor;
  const ActorState* a = actor(c, id);
  const NpcDef* n = c.data.npc(id);
  std::vector<std::string> parts;
  parts.push_back("Время смены " + format_seconds_ru(static_cast<double>(c.st.sim_ms) / 1000.0) + ".");
  parts.push_back(n->name_ru + " (" + n->role_ru + "), место: " + c.data.label(a->zone) + ".");
  if (!a->task_id.empty()) {
    const Task& t = c.st.tasks.at(a->task_id);
    const ActionDef* def = c.data.action(t.action);
    parts.push_back("Текущая задача: «" + (def ? def->label_ru : t.action) + (t.target.empty() ? "" : " — " + c.data.label(t.target)) + "».");
  } else {
    parts.push_back("Активной задачи нет.");
  }
  parts.push_back("Усталость " + format_number_ru(std::round(a->fatigue * 100) / 100) + " (" + fatigue_word(a->fatigue) + ").");
  if (c.st.emergency) {
    const std::string& s = c.st.emergency_sensor;
    const std::string zone = c.data.home_zone_of(s);
    parts.push_back("Включён аварийный свет: тревога давления, " + c.data.label(zone) + ".");
    if (knows(c, id, "sensor_a_drop") || knows(c, id, "pressure_disagreement")) {
      const auto& r = c.st.sensors.at(s).reading;
      parts.push_back(c.data.label(s) + " показывает " + fixed(r.value, 1) + " " + c.data.sensor(s)->unit +
                      (r.trend == "falling" ? ", падает." : "."));
    }
  }
  if (!a->plan_id.empty()) {
    const Plan& p = c.st.plans.at(a->plan_id);
    const ActionDef* def = c.data.action(p.proposal.action);
    parts.push_back("Твой план «" + (def ? def->label_ru : p.proposal.action) + "» ждёт решения Алекса.");
  }
  if (!item.situation.text_ru.empty()) parts.push_back(item.situation.text_ru);
  if (item.situation.has_order) {
    const Proposal& o = item.situation.order;
    const ActionDef* def = c.data.action(o.action);
    std::string order = "Алекс приказывает: «" + (def ? def->label_ru : o.action) + "»";
    if (!o.target.empty()) order += ", цель — " + c.data.label(o.target);
    if (!o.companion.empty()) order += ", напарник — " + c.data.label(o.companion);
    parts.push_back(order + ". Выполни или откажись с обоснованием.");
  }
  if (item.situation.origin == "player_say") parts.push_back("Алекс обращается к тебе напрямую.");
  std::vector<std::string> free_crew;
  for (const auto& npc : c.data.crew) {
    if (npc.is_player || npc.id == id) continue;
    if (companion_available(c, npc.id, "")) free_crew.push_back(npc.name_ru + " (" + c.data.label(c.st.actors.at(npc.id).zone) + ")");
  }
  if (!free_crew.empty()) parts.push_back("Свободны: " + join(free_crew, ", ") + ".");
  if (n->role == "medic") {
    for (const auto& npc : c.data.crew) {
      if (npc.is_player || npc.id == id) continue;
      const double f = c.st.actors.at(npc.id).fatigue;
      if (f > 0.55) parts.push_back(npc.name_ru + ": заметная усталость (" + format_number_ru(std::round(f * 100) / 100) + ").");
    }
  }
  return join(parts, " ");
}

}  // namespace

const OfferedAction* Offer::find(const std::string& id) const {
  for (const auto& a : actions) {
    if (a.id == id) return &a;
  }
  return nullptr;
}

std::vector<std::string> situation_entities(const Core& c, const std::string& actor_id, const Situation& sit) {
  std::vector<std::string> ents;
  auto add_with_zone = [&](const std::string& id) {
    if (id.empty()) return;
    append_unique(ents, id);
    const std::string zone = zone_of_entity(c, id);
    if (!zone.empty() && c.data.kind_of(id) != "actor") {
      append_unique(ents, zone);
      for (const auto& s : c.data.sensors) {
        if (s.zone == zone) append_unique(ents, s.id);
      }
      for (const auto& it : c.data.items) {
        if (c.st.items.at(it.id).zone == zone) append_unique(ents, it.id);
      }
    }
  };
  add_with_zone(sit.focus);
  if (sit.has_order) {
    add_with_zone(sit.order.target);
    append_unique(ents, sit.order.companion);
  }
  if (c.st.emergency) add_with_zone(c.st.emergency_sensor);
  append_unique(ents, actor_id);
  append_unique(ents, c.data.player_id);
  if (const ActorState* a = actor(c, actor_id)) append_unique(ents, a->zone);
  ents.erase(std::remove(ents.begin(), ents.end(), std::string()), ents.end());
  return ents;
}

std::vector<std::string> visible_facts(const Core& c, const std::string& actor_id, const Situation& sit) {
  const auto mem = c.st.memory.find(actor_id);
  if (mem == c.st.memory.end()) return {};
  const std::vector<std::string> ents = situation_entities(c, actor_id, sit);
  struct Scored {
    std::string id;
    int score;
    std::int64_t t;
  };
  std::vector<Scored> scored;
  for (const auto& k : mem->second.facts) {
    const FactDef* f = c.data.fact(k.fact);
    if (f == nullptr || f->is_protected) continue;  // protected facts are never offered to any model
    int score = 0;
    for (const auto& about : f->about) {
      if (contains(ents, about)) score += 2;
    }
    if (c.st.sim_ms - k.time_ms <= kRecentlyLearnedMs && k.time_ms > 0) score += 1;
    if (score == 0) continue;  // not relevant to this situation
    scored.push_back({k.fact, score, k.time_ms});
  }
  std::stable_sort(scored.begin(), scored.end(), [](const Scored& a, const Scored& b) {
    if (a.score != b.score) return a.score > b.score;
    return a.t > b.t;
  });
  std::vector<std::string> out;
  for (const auto& s : scored) {
    if (out.size() >= kMaxVisibleFacts) break;
    out.push_back(s.id);
  }
  return out;
}

Offer compute_offer(const Core& c, const std::string& actor_id, const Situation& sit) {
  Offer offer;
  offer.world_revision = c.st.revision;
  offer.visible_facts = visible_facts(c, actor_id, sit);
  const std::vector<std::string> ents = situation_entities(c, actor_id, sit);
  for (const auto& a : c.data.actions) {
    if (!role_check(c, actor_id, a).empty()) continue;
    if (!cooldown_check(c, actor_id, a).empty()) continue;
    if (!actor_state_check(c, actor_id, a, "").empty()) continue;
    if (!tools_check(c, a, "").empty()) continue;
    if (!resources_check(c, a, "").empty()) continue;
    OfferedAction oa;
    oa.id = a.id;
    oa.target_required = a.target_required;
    oa.fact_min = a.fact_min;
    oa.fact_max = a.fact_max;
    if (static_cast<int>(offer.visible_facts.size()) < a.fact_min) continue;
    std::vector<std::string> cands;
    for (const auto& kind : a.target_kinds) {
      if (kind == "sensor") for (const auto& s : c.data.sensors) cands.push_back(s.id);
      if (kind == "zone") for (const auto& z : c.data.zones) cands.push_back(z.id);
      if (kind == "item") for (const auto& it : c.data.items) cands.push_back(it.id);
      if (kind == "actor") for (const auto& n : c.data.crew) if (!n.is_player) cands.push_back(n.id);
    }
    struct Ranked {
      std::string id;
      int rel;
      std::size_t order;
    };
    std::vector<Ranked> ranked;
    for (std::size_t i = 0; i < cands.size(); ++i) {
      if (!target_check(c, actor_id, a, cands[i], "").empty()) continue;
      ranked.push_back({cands[i], target_relevance(c, actor_id, sit, ents, cands[i]), i});
    }
    std::stable_sort(ranked.begin(), ranked.end(), [](const Ranked& x, const Ranked& y) { return x.rel > y.rel; });
    for (const auto& r : ranked) {
      if (oa.targets.size() >= kMaxTargetsPerAction) break;
      oa.targets.push_back(r.id);
    }
    if (a.target_required && oa.targets.empty()) continue;
    if (a.companion != "none") {
      std::vector<std::pair<double, std::string>> comps;
      const ActorState* self = actor(c, actor_id);
      for (const auto& n : c.data.crew) {
        if (n.is_player || n.id == actor_id || !companion_available(c, n.id, "")) continue;
        const auto rel = self->relationships.find(n.id);
        comps.emplace_back(rel == self->relationships.end() ? 0.0 : rel->second, n.id);
      }
      std::stable_sort(comps.begin(), comps.end(), [](const auto& x, const auto& y) { return x.first > y.first; });
      for (const auto& [rel, id] : comps) {
        if (oa.companions.size() >= kMaxCompanions) break;
        oa.companions.push_back(id);
      }
    }
    offer.actions.push_back(oa);
  }
  return offer;
}

void compact_resolved_request(PendingRequest& rec) {
  if (rec.state == "pending" || rec.request["compacted"].as_bool()) return;
  json::Value c = json::Value::object();
  c.set("task_id", rec.request["task_id"]);
  c.set("actor_id", rec.request["actor_id"]);
  c.set("world_revision", rec.request["world_revision"]);
  json::Value actions = json::Value::array();
  for (const auto& a : rec.request["allowed_actions"].items()) {
    json::Value x = json::Value::object();
    x.set("id", a["id"]);
    x.set("fact_ids_min", a["fact_ids_min"]);
    x.set("fact_ids_max", a["fact_ids_max"]);
    actions.push(x);
  }
  c.set("allowed_actions", actions);
  json::Value facts = json::Value::array();
  for (const auto& f : rec.request["visible_facts"].items()) {
    json::Value x = json::Value::object();
    x.set("id", f["id"]);
    facts.push(x);
  }
  c.set("visible_facts", facts);
  c.set("compacted", true);
  rec.request = std::move(c);
}

Offer offer_from_request(const json::Value& request) {
  Offer offer;
  offer.world_revision = request["world_revision"].as_int();
  for (const auto& a : request["allowed_actions"].items()) {
    OfferedAction oa;
    oa.id = a["id"].str();
    oa.target_required = a["target_required"].as_bool();
    oa.fact_min = static_cast<int>(a["fact_ids_min"].as_int());
    oa.fact_max = static_cast<int>(a["fact_ids_max"].as_int());
    for (const auto& t : a["targets"].items()) oa.targets.push_back(t["id"].str());
    for (const auto& t : a["companions"].items()) oa.companions.push_back(t["id"].str());
    offer.actions.push_back(oa);
  }
  for (const auto& f : request["visible_facts"].items()) offer.visible_facts.push_back(f["id"].str());
  return offer;
}

std::vector<std::string> recent_events_for(const Core& c, const std::string& actor_id, std::size_t limit) {
  std::vector<std::string> out;
  for (auto it = c.st.events.rbegin(); it != c.st.events.rend() && out.size() < limit; ++it) {
    const Event& e = *it;
    const json::Value& p = e.payload;
    std::string text;
    if (e.type == "trigger_fired") {
      const std::string zone = c.data.home_zone_of(p["sensor"].str());
      text = (knows(c, actor_id, "sensor_a_drop") || actor_id == c.data.player_id) ? describe_event_ru(c, e)
                                                                                     : "Сработала тревога давления: " + c.data.label(zone) + ".";
    } else if (e.type == "emergency_lights" || e.type == "sensor_repaired" || e.type == "zone_sealed") {
      text = describe_event_ru(c, e);
    } else if (e.type == "speech" && e.actor == actor_id) {
      text = describe_event_ru(c, e);
    } else if ((e.type == "player_said" || e.type == "player_ordered") && p["npc"].str() == actor_id) {
      text = describe_event_ru(c, e);
    } else if ((e.type == "task_started" || e.type == "task_completed") &&
               (e.actor == actor_id || p["companion"].str() == actor_id || p["proposer"].str() == actor_id)) {
      text = describe_event_ru(c, e);
    } else if ((e.type == "plan_created" || e.type == "plan_decided" || e.type == "plan_expired") && e.actor == actor_id) {
      text = describe_event_ru(c, e);
    } else if (e.type == "facts_revealed" && p["to"].str() == actor_id) {
      std::vector<std::string> texts;
      for (const auto& f : p["facts"].items()) {
        const FactDef* fd = c.data.fact(f.str());
        if (fd != nullptr && !fd->is_protected && knows(c, actor_id, f.str())) texts.push_back(fd->text_ru);
      }
      if (!texts.empty()) text = "Новые сведения: " + join(texts, " ");
    } else if (e.type == "director_sound" && p["witness"].str() == actor_id) {
      text = p["text_ru"].str();
    }
    if (!text.empty()) out.push_back("[" + format_seconds_ru(static_cast<double>(e.t_ms) / 1000.0) + "] " + text);
  }
  std::reverse(out.begin(), out.end());
  return out;
}

json::Value build_gateway_request(const Core& c, const QueueItem& item, double now_ms) {
  const NpcDef* n = c.data.npc(item.actor);
  const AdmissionConfig& adm = c.data.profiles.admission;
  Offer offer = compute_offer(c, item.actor, item.situation);

  // ---- role layer
  json::Value persona = json::Value::object();
  persona.set("name", n->name_ru);
  persona.set("role", n->role_ru);
  persona.set("values", n->values_ru);
  persona.set("style", n->quirks_ru.empty() ? n->style_ru : n->style_ru + " Речевые привычки: " + n->quirks_ru);
  persona.set("boundaries", n->boundaries_ru);
  const std::string role_text = "Персонаж: " + n->name_ru + ", " + n->role_ru + ".\nЦенности: " + n->values_ru +
                                "\nМанера: " + persona["style"].str() + "\nГраницы: " + n->boundaries_ru;
  const int role_tokens = estimate_tokens(role_text);

  // ---- situation layer (truncated to its budget and to the schema's 1200 characters)
  std::string situation = situation_text(c, item);
  const std::string utterance = item.situation.utterance;
  const int sit_max = layer_max(c, "situation");
  const int utter_tokens = utterance.empty() ? 0 : estimate_tokens(utterance) + 12;
  std::size_t sit_cp = std::min<std::size_t>(1200, static_cast<std::size_t>(std::max(0, sit_max - utter_tokens)) * 32 / 10);
  if (utf8_length(situation) > sit_cp) situation = utf8_truncate(situation, sit_cp);
  const int situation_tokens = estimate_tokens(situation) + utter_tokens;

  // ---- knowledge layer: visible facts by relevance, within budget
  std::vector<std::string> fact_lines;
  std::vector<std::string> facts;
  const auto& mem = c.st.memory.at(item.actor);
  auto source_of = [&](const std::string& f) {
    for (const auto& k : mem.facts) {
      if (k.fact == f) return k.source;
    }
    return std::string();
  };
  for (const auto& f : offer.visible_facts) {
    const std::string line = "- " + f + ": " + c.data.fact(f)->text_ru + " [источник: " + source_of(f) + "]";
    std::vector<std::string> trial = fact_lines;
    trial.push_back(line);
    if (lines_tokens(trial) > layer_max(c, "knowledge")) break;
    fact_lines = trial;
    facts.push_back(f);
  }
  offer.visible_facts = facts;

  // ---- relations layer: opinions, promises, episodes (fact entries are already in visible_facts)
  const std::vector<std::string> ents = situation_entities(c, item.actor, item.situation);
  std::vector<const MemoryEntry*> entries;
  for (const auto& m : mem.entries) {
    if (m.kind != "fact") entries.push_back(&m);
  }
  auto mem_score = [&](const MemoryEntry* m) {
    double s = m->importance;
    for (const auto& t : m->tags) {
      if (contains(ents, t)) {
        s += 0.3;
        break;
      }
    }
    if (c.st.sim_ms - m->time_ms <= 600000) s += 0.2;
    return s;
  };
  std::stable_sort(entries.begin(), entries.end(), [&](const MemoryEntry* a, const MemoryEntry* b) {
    const double sa = mem_score(a), sb = mem_score(b);
    if (sa != sb) return sa > sb;
    return a->time_ms > b->time_ms;
  });
  std::vector<const MemoryEntry*> excerpt;
  std::vector<std::string> relation_lines;
  for (const MemoryEntry* m : entries) {
    if (excerpt.size() >= kMaxMemoryExcerpt) break;
    std::vector<std::string> trial = relation_lines;
    trial.push_back(memory_line(*m));
    if (lines_tokens(trial) > layer_max(c, "relations")) break;
    relation_lines = trial;
    excerpt.push_back(m);
  }

  // ---- recent layer
  std::vector<std::string> recent = recent_events_for(c, item.actor, kMaxRecentEvents);
  std::vector<std::string> recent_lines;
  auto recent_tokens = [&]() {
    recent_lines.clear();
    for (const auto& r : recent) recent_lines.push_back("- " + r);
    return lines_tokens(recent_lines);
  };
  while (!recent.empty() && recent_tokens() > layer_max(c, "recent")) recent.erase(recent.begin());

  // ---- format layer: prune the least relevant targets/actions until within budget
  auto action_priority = [&](const OfferedAction& a) {
    if (a.id == "acknowledge" || a.id == "refuse") return 1000;
    if (item.situation.has_order && a.id == item.situation.order.action) return 900;
    if (a.id == "report_observation") return 500;
    int best = 0;
    for (const auto& t : a.targets) best = std::max(best, target_relevance(c, item.actor, item.situation, ents, t));
    // Specialist actions (few roles may take them) express the character; keep them over generic ones.
    const ActionDef* def = c.data.action(a.id);
    int specialty = 0;
    if (def != nullptr && !contains(def->roles, "*")) specialty = def->roles.size() == 1 ? 25 : 5;
    return 10 + best * 10 + specialty;
  };
  // Drop actions whose fact minimum is no longer met after knowledge pruning.
  offer.actions.erase(std::remove_if(offer.actions.begin(), offer.actions.end(),
                                     [&](const OfferedAction& a) { return static_cast<int>(facts.size()) < a.fact_min; }),
                      offer.actions.end());
  const int format_max = layer_max(c, "format");
  while (estimate_tokens(render_format(c, offer)) > format_max) {
    // Shrink lists before dropping choices: targets to two, companions to two, then to one each;
    // only then drop the least relevant optional action.
    OfferedAction* widest = nullptr;
    for (auto& a : offer.actions) {
      if (a.targets.size() > 1 && (widest == nullptr || a.targets.size() > widest->targets.size())) widest = &a;
    }
    if (widest != nullptr && widest->targets.size() > 2) {
      widest->targets.pop_back();
      continue;
    }
    bool trimmed = false;
    for (const std::size_t limit : {std::size_t{2}, std::size_t{1}}) {
      for (auto& a : offer.actions) {
        if (a.companions.size() > limit) {
          a.companions.pop_back();
          trimmed = true;
          break;
        }
      }
      if (trimmed) break;
    }
    if (trimmed) continue;
    std::size_t victim = offer.actions.size();
    int lowest = 1 << 30;
    for (std::size_t i = 0; i < offer.actions.size(); ++i) {
      const int pr = action_priority(offer.actions[i]);
      if (pr < 900 && pr <= lowest) {
        lowest = pr;
        victim = i;
      }
    }
    if (victim < offer.actions.size()) {
      offer.actions.erase(offer.actions.begin() + static_cast<std::ptrdiff_t>(victim));
      continue;
    }
    if (widest != nullptr) {
      widest->targets.pop_back();
      continue;
    }
    break;
  }
  const int format_tokens = estimate_tokens(render_format(c, offer));

  // ---- total budget: shed recent events, then relations, then knowledge
  auto total = [&]() {
    return kFixedPromptTokens + role_tokens + situation_tokens + lines_tokens(fact_lines) + lines_tokens(relation_lines) +
           recent_tokens() + format_tokens;
  };
  while (total() > adm.max_input_tokens) {
    if (recent.size() > 3) recent.erase(recent.begin());
    else if (excerpt.size() > 2) {
      excerpt.pop_back();
      relation_lines.pop_back();
    } else if (facts.size() > 1) {
      facts.pop_back();
      fact_lines.pop_back();
    } else if (!recent.empty()) recent.erase(recent.begin());
    else break;
  }
  offer.visible_facts = facts;
  recent_tokens();

  // ---- assemble
  json::Value req = json::Value::object();
  req.set("schema_version", kIntentSchemaVersion);
  req.set("task_id", item.task_id);
  req.set("actor_id", item.actor);
  req.set("kind", item.kind == "emergency" ? "initiative" : item.kind);
  req.set("capability", "generate_intent");
  req.set("world_revision", static_cast<double>(c.st.revision));
  req.set("locale", "ru-RU");
  const double remaining = std::floor(item.deadline_ms - now_ms);
  req.set("deadline_ms", std::clamp(remaining, 100.0, 60000.0));
  req.set("max_input_tokens", adm.max_input_tokens);
  const bool extended = c.rt.config.mode == "extended" && !c.st.emergency;
  req.set("max_output_tokens", extended ? std::min(1024, adm.max_output_tokens * 2) : adm.max_output_tokens);
  req.set("privacy_profile", c.rt.config.privacy_profile);
  req.set("persona", persona);
  req.set("situation", situation);
  json::Value actions = json::Value::array();
  for (const auto& a : offer.actions) {
    const ActionDef* def = c.data.action(a.id);
    json::Value av = json::Value::object();
    av.set("id", a.id);
    av.set("label", def->label_ru);
    json::Value targets = json::Value::array();
    for (const auto& t : a.targets) {
      json::Value tv = json::Value::object();
      tv.set("id", t);
      tv.set("label", c.data.label(t));
      targets.push(tv);
    }
    av.set("targets", targets);
    av.set("target_required", a.target_required);
    json::Value comps = json::Value::array();
    for (const auto& t : a.companions) {
      json::Value tv = json::Value::object();
      tv.set("id", t);
      tv.set("label", c.data.label(t));
      comps.push(tv);
    }
    av.set("companions", comps);
    av.set("fact_ids_min", a.fact_min);
    av.set("fact_ids_max", a.fact_max);
    actions.push(av);
  }
  req.set("allowed_actions", actions);
  json::Value vf = json::Value::array();
  for (const auto& f : facts) {
    json::Value fv = json::Value::object();
    fv.set("id", f);
    fv.set("text", c.data.fact(f)->text_ru);
    fv.set("source", source_of(f));
    vf.push(fv);
  }
  req.set("visible_facts", vf);
  json::Value me = json::Value::array();
  for (const MemoryEntry* m : excerpt) {
    json::Value mv = json::Value::object();
    mv.set("kind", m->kind);
    mv.set("text", m->text_ru);
    mv.set("source", m->source);
    if (m->confidence >= 0) mv.set("confidence", m->confidence);
    me.push(mv);
  }
  req.set("memory_excerpt", me);
  req.set("recent_events", json::Value::string_array(recent));
  req.set("player_utterance", utterance.empty() ? json::Value() : json::Value(utf8_truncate(utterance, 600, "")));
  req.set("styles", json::Value::string_array(c.data.styles));
  req.set("gestures", json::Value::string_array(c.data.gestures));
  json::Value te = json::Value::object();
  te.set("role", role_tokens);
  te.set("knowledge", lines_tokens(fact_lines));
  te.set("situation", situation_tokens);
  te.set("recent", lines_tokens(recent_lines));
  te.set("relations", lines_tokens(relation_lines));
  te.set("format", format_tokens);
  te.set("system_fixed", kFixedPromptTokens);
  te.set("total", total());
  req.set("token_estimate", te);
  req.set("prompt_version", kPromptVersion);
  return req;
}

}  // namespace echo
