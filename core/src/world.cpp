#include "echo/world.hpp"

#include <algorithm>
#include <cmath>
#include <deque>
#include <map>

namespace echo {
namespace {

constexpr std::size_t kMaxMemoryEntries = 160;
constexpr std::int64_t kWalkHopMs = 3000;

double layer_importance(const std::string& layer) {
  if (layer == "physical" || layer == "instrument") return 0.7;
  if (layer == "history") return 0.6;
  if (layer == "interpretation") return 0.5;
  return 0.4;
}

std::int64_t history_time_ms(const StaticData& d, const std::string& source) {
  if (!starts_with(source, "event:")) return 0;
  const std::string id = source.substr(6);
  for (const auto& h : d.history) {
    if (h.id == id) return static_cast<std::int64_t>(std::llround(h.time_s * 1000.0));
  }
  return 0;
}

void trim_memory(ActorMemory& m) {
  if (m.entries.size() < kMaxMemoryEntries) return;
  // Drop the least important, oldest non-fact entry; facts stay (they mirror known_facts with sources).
  auto victim = m.entries.end();
  for (auto it = m.entries.begin(); it != m.entries.end(); ++it) {
    if (it->kind == "fact") continue;
    if (victim == m.entries.end() || it->importance < victim->importance ||
        (it->importance == victim->importance && it->time_ms < victim->time_ms)) {
      victim = it;
    }
  }
  if (victim != m.entries.end()) m.entries.erase(victim);
}

}  // namespace

void init_state(Core& c, std::uint64_t seed) {
  const StaticData& d = c.data;
  State st;
  st.seed = seed;
  st.rng.set_state(seed);
  st.sim_ms = 0;
  for (const auto& door : d.doors) st.doors[door.id] = DoorState{door.state};
  for (const auto& r : d.resources) st.resources[r.id] = ResourceState{r.amount, 0.0};
  for (const auto& it : d.items) {
    ItemState is;
    is.zone = it.zone;
    st.items[it.id] = is;
  }
  for (const auto& s : d.sensors) {
    SensorState ss;
    ss.truth = s.truth;
    ss.reading = s.reading;
    ss.fault = s.fault;
    st.sensors[s.id] = ss;
  }
  for (const auto& door : d.doors) {
    if (door.state == "sealed") {
      // A zone counts as sealed only when every door into it is sealed.
      for (const std::string& z : {door.a, door.b}) {
        bool all_sealed = true;
        for (const auto& other : d.doors) {
          if ((other.a == z || other.b == z) && other.state != "sealed") all_sealed = false;
        }
        if (all_sealed) st.sealed_zones.insert(z);
      }
    }
  }
  for (const auto& n : d.crew) {
    ActorState a;
    a.id = n.id;
    a.zone = n.zone;
    a.home_zone = n.zone;
    a.fatigue = n.fatigue;
    a.health = n.health;
    a.trust_player = n.trust_player;
    for (const auto& [other, v] : n.relationships) a.relationships[other] = v;
    st.actors[n.id] = a;
    st.memory[n.id];
  }
  st.director.tension = d.director.tension_initial;
  st.director.next_eval_ms = static_cast<std::int64_t>(std::llround(d.director.evaluate_every_s * 1000.0));
  st.director.last_echo_ms = 0;
  bool have_echo = false;
  for (const auto& h : d.history) {
    if (h.type == "anomaly") {
      const auto t = static_cast<std::int64_t>(std::llround(h.time_s * 1000.0));
      if (!have_echo || t > st.director.last_echo_ms) st.director.last_echo_ms = t;
      have_echo = true;
    }
  }
  if (!have_echo) st.director.last_echo_ms = -86400000;
  st.next_ambient_ms = 75000;
  c.st = std::move(st);

  // Knowledge, history episodes and opinions with their original sources.
  for (const auto& [actor_id, seeds] : d.initial_knowledge) {
    for (const auto& k : seeds) {
      if (learn(c, actor_id, k.fact, k.source)) {
        auto& m = c.st.memory[actor_id];
        const auto t = history_time_ms(d, k.source);
        m.facts.back().time_ms = t;
        m.entries.back().time_ms = t;
      }
    }
  }
  for (const auto& h : d.history) {
    for (const auto& a : h.actors) {
      if (c.st.actors.count(a) == 0) continue;
      MemoryEntry& e = remember(c, a, "episode", h.summary_ru, "event:" + h.id, 0.6, h.actors);
      e.time_ms = static_cast<std::int64_t>(std::llround(h.time_s * 1000.0));
    }
  }
  for (const auto& [actor_id, ops] : d.initial_opinions) {
    for (const auto& o : ops) {
      MemoryEntry& e = remember(c, actor_id, "opinion", o.text_ru, o.source, 0.55, {o.about}, o.confidence);
      e.time_ms = history_time_ms(d, o.source);
    }
  }
  c.st.revision = 1;
  json::Value p = json::Value::object();
  p.set("world", d.world_id);
  p.set("seed", static_cast<double>(seed));
  emit(c, "sim_started", "", std::move(p), kSrcSim);
}

void bump_revision(Core& c, const std::vector<std::string>& entities) {
  ++c.st.revision;
  for (const auto& e : entities) {
    if (!e.empty()) c.st.entity_rev[e] = c.st.revision;
  }
}

std::int64_t entity_rev(const Core& c, const std::string& entity) {
  const auto it = c.st.entity_rev.find(entity);
  return it == c.st.entity_rev.end() ? 0 : it->second;
}

const Event& emit(Core& c, const std::string& type, const std::string& actor_id, json::Value payload,
                  const std::string& source) {
  Event e;
  e.seq = static_cast<std::int64_t>(c.st.next_seq++);
  e.t_ms = c.st.sim_ms;
  e.rev = c.st.revision;
  e.type = type;
  e.actor = actor_id;
  e.source = source;
  e.payload = std::move(payload);
  c.st.events.push_back(std::move(e));
  c.rt.out_events.push_back(c.st.events.size() - 1);
  return c.st.events.back();
}

json::Value event_json(const Event& e) {
  json::Value v = json::Value::object();
  v.set("seq", static_cast<double>(e.seq));
  v.set("t", static_cast<double>(e.t_ms) / 1000.0);
  v.set("rev", static_cast<double>(e.rev));
  v.set("type", e.type);
  v.set("actor", e.actor.empty() ? json::Value() : json::Value(e.actor));
  v.set("source", e.source);
  v.set("payload", e.payload);
  return v;
}

json::Value event_json_ru(const Core& c, const Event& e) {
  json::Value v = event_json(e);
  v.set("text_ru", describe_event_ru(c, e));
  return v;
}

ActorState* actor(Core& c, const std::string& id) {
  const auto it = c.st.actors.find(id);
  return it == c.st.actors.end() ? nullptr : &it->second;
}

const ActorState* actor(const Core& c, const std::string& id) {
  const auto it = c.st.actors.find(id);
  return it == c.st.actors.end() ? nullptr : &it->second;
}

bool is_npc(const Core& c, const std::string& id) {
  const NpcDef* n = c.data.npc(id);
  return n != nullptr && !n->is_player;
}

bool actor_busy(const Core& c, const std::string& id) {
  const ActorState* a = actor(c, id);
  return a == nullptr || !a->task_id.empty() || a->debug_busy;
}

std::string name_of(const Core& c, const std::string& id) { return c.data.label(id); }

const KnownFact* known_fact(const Core& c, const std::string& actor_id, const std::string& fact) {
  const auto it = c.st.memory.find(actor_id);
  if (it == c.st.memory.end()) return nullptr;
  for (const auto& k : it->second.facts) {
    if (k.fact == fact) return &k;
  }
  return nullptr;
}

bool knows(const Core& c, const std::string& actor_id, const std::string& fact) {
  return known_fact(c, actor_id, fact) != nullptr;
}

bool learn(Core& c, const std::string& actor_id, const std::string& fact, const std::string& source) {
  const FactDef* f = c.data.fact(fact);
  if (f == nullptr || f->is_protected || c.st.actors.count(actor_id) == 0) return false;
  if (knows(c, actor_id, fact)) return false;
  auto& m = c.st.memory[actor_id];
  trim_memory(m);
  m.facts.push_back(KnownFact{fact, source, c.st.sim_ms});
  MemoryEntry e;
  e.id = format_id("mem-", c.st.next_mem++, 5);
  e.kind = "fact";
  e.fact_id = fact;
  e.text_ru = f->text_ru;
  e.source = source;
  e.importance = layer_importance(f->layer);
  e.time_ms = c.st.sim_ms;
  e.tags = f->about;
  e.tags.push_back("layer:" + f->layer);
  m.entries.push_back(std::move(e));
  return true;
}

void reconfirm(Core& c, const std::string& actor_id, const std::string& fact, const std::string& source) {
  if (!learn(c, actor_id, fact, source)) {
    auto& m = c.st.memory[actor_id];
    for (auto& k : m.facts) {
      if (k.fact == fact) {
        k.source = source;
        k.time_ms = c.st.sim_ms;
      }
    }
    for (auto& e : m.entries) {
      if (e.kind == "fact" && e.fact_id == fact) {
        e.source = source;
        e.time_ms = c.st.sim_ms;
      }
    }
  }
}

MemoryEntry& remember(Core& c, const std::string& actor_id, const std::string& kind, const std::string& text_ru,
                      const std::string& source, double importance, std::vector<std::string> tags, double confidence) {
  auto& m = c.st.memory[actor_id];
  trim_memory(m);
  MemoryEntry e;
  e.id = format_id("mem-", c.st.next_mem++, 5);
  e.kind = kind;
  e.text_ru = text_ru;
  e.source = source;
  e.importance = importance;
  e.confidence = confidence;
  e.time_ms = c.st.sim_ms;
  e.tags = std::move(tags);
  m.entries.push_back(std::move(e));
  return m.entries.back();
}

Route find_route(const Core& c, const std::string& from, const std::string& to) {
  Route r;
  if (c.data.zone(from) == nullptr || c.data.zone(to) == nullptr) {
    r.blocked_reason = "unknown_zone";
    return r;
  }
  if (from == to) {
    r.ok = true;
    r.zones = {from};
    return r;
  }
  if (c.st.sealed_zones.count(to) != 0) {
    r.blocked_reason = "zone_sealed";
    return r;
  }
  std::map<std::string, std::pair<std::string, std::string>> parent;  // zone -> (prev zone, door)
  std::deque<std::string> q{from};
  parent[from] = {"", ""};
  while (!q.empty()) {
    const std::string z = q.front();
    q.pop_front();
    if (z == to) break;
    for (const auto& door : c.data.doors) {
      if (door.a != z && door.b != z) continue;
      if (c.st.doors.at(door.id).state == "sealed") continue;
      const std::string next = door.a == z ? door.b : door.a;
      if (parent.count(next) != 0 || c.st.sealed_zones.count(next) != 0) continue;
      parent[next] = {z, door.id};
      q.push_back(next);
    }
  }
  if (parent.count(to) == 0) {
    r.blocked_reason = "route_sealed";
    return r;
  }
  std::vector<std::string> zones, doors;
  for (std::string z = to; !z.empty(); z = parent[z].first) {
    zones.push_back(z);
    if (!parent[z].second.empty()) doors.push_back(parent[z].second);
  }
  std::reverse(zones.begin(), zones.end());
  std::reverse(doors.begin(), doors.end());
  r.ok = true;
  r.zones = zones;
  r.doors = doors;
  return r;
}

std::int64_t hop_duration_ms(const Core& c, const std::string& door_id) {
  const DoorDef* def = c.data.door(door_id);
  if (def == nullptr) return kWalkHopMs;
  const std::string& state = c.st.doors.at(door_id).state;
  if (state == "closed") {
    return kWalkHopMs + (def->cycle_s > 0 ? static_cast<std::int64_t>(std::llround(def->cycle_s * 1000.0)) : 1000);
  }
  return kWalkHopMs;
}

bool zone_requires_suit(const Core& c, const std::string& zone) {
  const ZoneDef* z = c.data.zone(zone);
  return z != nullptr && z->suit_required;
}

bool eva_ok(const Core& c, const std::string& actor_id, const std::vector<std::string>& zones, std::string& why) {
  const NpcDef* n = c.data.npc(actor_id);
  const ActorState* a = actor(c, actor_id);
  if (n == nullptr || a == nullptr) {
    why = "unknown_actor";
    return false;
  }
  for (std::size_t i = 1; i < zones.size(); ++i) {
    if (!zone_requires_suit(c, zones[i])) continue;
    if (n->skill("eva") < c.data.physical.eva_min_skill) {
      why = "eva_skill";
      return false;
    }
    if (a->fatigue > c.data.physical.eva_max_fatigue) {
      why = "eva_fatigue";
      return false;
    }
  }
  return true;
}

double resource_free(const Core& c, const std::string& resource) {
  const auto it = c.st.resources.find(resource);
  if (it == c.st.resources.end()) return 0.0;
  return it->second.amount - it->second.reserved;
}

bool sensor_fault_active(const Core& c, const std::string& sensor_or_zone) {
  if (const auto it = c.st.sensors.find(sensor_or_zone); it != c.st.sensors.end()) return !it->second.fault.empty();
  for (const auto& s : c.data.sensors) {
    if (s.zone == sensor_or_zone && !c.st.sensors.at(s.id).fault.empty()) return true;
  }
  return false;
}

std::string zone_of_entity(const Core& c, const std::string& id) {
  if (const ActorState* a = actor(c, id)) return a->zone;
  if (const auto it = c.st.items.find(id); it != c.st.items.end()) return it->second.zone;
  return c.data.home_zone_of(id);
}

std::string describe_event_ru(const Core& c, const Event& e) {
  const json::Value& p = e.payload;
  const std::string who = e.actor.empty() ? std::string() : name_of(c, e.actor);
  auto with_companion = [&](const json::Value& v) {
    const std::string comp = v["companion"].str();
    return comp.empty() ? std::string() : " (напарник: " + name_of(c, comp) + ")";
  };
  auto target_label = [&](const json::Value& v) {
    const std::string t = v["target"].str();
    return t.empty() ? std::string() : " — " + name_of(c, t);
  };
  if (e.type == "sim_started") return "Начало смены. Колония D0 работает в штатном режиме.";
  if (e.type == "trigger_fired") {
    const json::Value& r = p["reading"];
    return "ТРЕВОГА: " + name_of(c, p["sensor"].str()) + " показывает " + format_number_ru(r["value"].as_number()) + " " +
           (c.data.sensor(p["sensor"].str()) ? c.data.sensor(p["sensor"].str())->unit : std::string()) +
           (r["trend"].str() == "falling" ? ", падает." : ".");
  }
  if (e.type == "emergency_lights") return p["on"].as_bool() ? "Включён аварийный свет." : "Аварийный свет выключен.";
  if (e.type == "facts_revealed") {
    std::vector<std::string> texts;
    for (const auto& f : p["facts"].items()) {
      if (const FactDef* fd = c.data.fact(f.str())) texts.push_back(fd->text_ru);
    }
    return name_of(c, p["to"].str()) + " узнаёт (" + p["source"].str() + "): " + join(texts, " ");
  }
  if (e.type == "speech") {
    const std::string g = p["gesture"].str();
    return who + ": «" + p["text"].str() + "»" + (g.empty() || g == "none" ? "" : " [" + g + "]");
  }
  if (e.type == "player_said") return "Алекс → " + name_of(c, p["npc"].str()) + ": «" + p["text"].str() + "»";
  if (e.type == "player_ordered") {
    const ActionDef* a = c.data.action(p["action"].str());
    return "Алекс приказывает " + name_of(c, p["npc"].str()) + ": " + (a ? a->label_ru : p["action"].str()) +
           target_label(p) + with_companion(p);
  }
  if (e.type == "plan_created") {
    const ActionDef* a = c.data.action(p["action"].str());
    return who + " предлагает план " + p["plan_id"].str() + ": " + (a ? a->label_ru : p["action"].str()) +
           target_label(p) + with_companion(p) + " — ждёт решения Алекса.";
  }
  if (e.type == "plan_decided") {
    return "Решение по плану " + p["plan_id"].str() + ": " + p["decision"].str() + " → " + p["result"].str() + ".";
  }
  if (e.type == "plan_expired") return "План " + p["plan_id"].str() + " истёк без решения; резерв снят.";
  if (e.type == "player_decision") {
    static const std::map<std::string, std::string> kDecision = {
        {"accept", "принять"}, {"reject", "отклонить"}, {"reassign", "сменить напарника"}, {"ask_evidence", "попросить доказательства"}};
    const auto it = kDecision.find(p["decision"].str());
    const std::string comp = p["companion"].str();
    return "Алекс: " + (it != kDecision.end() ? it->second : p["decision"].str()) + " план " + p["plan_id"].str() +
           (comp.empty() ? "" : " (напарник: " + name_of(c, comp) + ")") + ".";
  }
  if (e.type == "task_started" && p["action"].str() == "propose_rest") {
    const std::string proposer = p["proposer"].str();
    return who + " идёт отдыхать" + (proposer.empty() || proposer == e.actor ? "" : " (по слову: " + name_of(c, proposer) + ")") + ".";
  }
  if (e.type == "task_completed" && p["action"].str() == "propose_rest") return who + ": отдых закончен.";
  if (e.type == "task_failed") return "Задача " + p["task_id"].str() + " сорвалась: " + p["reason"].str() + "; резерв снят.";
  if (e.type == "task_started") {
    const ActionDef* a = c.data.action(p["action"].str());
    return who + " начинает: " + (a ? a->label_ru : p["action"].str()) + target_label(p) + with_companion(p) + ".";
  }
  if (e.type == "task_work_started") return who + " на месте (" + name_of(c, p["zone"].str()) + "), работа началась.";
  if (e.type == "task_completed") {
    const ActionDef* a = c.data.action(p["action"].str());
    return who + " завершает: " + (a ? a->label_ru : p["action"].str()) + target_label(p) + ".";
  }
  if (e.type == "task_cancelled") return "Задача " + p["task_id"].str() + " отменена, резерв снят.";
  if (e.type == "resource_consumed") {
    return "Списано: " + name_of(c, p["resource"].str()) + " −" + format_number_ru(p["amount"].as_number()) +
           " (осталось " + format_number_ru(p["left"].as_number()) + ").";
  }
  if (e.type == "sensor_repaired") return name_of(c, p["sensor"].str()) + " откалиброван: показания совпадают с манометром.";
  if (e.type == "zone_sealed") return name_of(c, p["zone"].str()) + " загерметизирована.";
  if (e.type == "request_queued") {
    return "Очередь ИИ: " + p["task_id"].str() + " (" + who + ", " + p["kind"].str() + ", приоритет " +
           format_number_ru(p["priority"].as_number()) + ").";
  }
  if (e.type == "request_replaced") return "Очередь ИИ: " + p["old"].str() + " заменён более свежим " + p["new"].str() + ".";
  if (e.type == "request_evicted") return "Очередь ИИ переполнена: " + p["task_id"].str() + " вытеснен, готовая реакция.";
  if (e.type == "request_dispatched") return "Запрос " + p["task_id"].str() + " выдан исполнителю «" + p["backend"].str() + "».";
  if (e.type == "request_expired") return "Запрос " + p["task_id"].str() + " просрочен — обычный игровой ИИ.";
  if (e.type == "request_cancelled") return "Запрос " + p["task_id"].str() + " отменён; поздний ответ будет отброшен.";
  if (e.type == "verdict") {
    return "Intent Authority " + p["task_id"].str() + " (" + who + "): " + p["status"].str() +
           (p["fallback_used"].as_bool() ? " + fallback" : "") + ".";
  }
  if (e.type == "director_event") return "Директор: " + p["label_ru"].str() + ".";
  if (e.type == "director_sound") return p["text_ru"].str();
  if (e.type == "director_recovered") return "Директор: последствия события " + p["event"].str() + " сняты (показания восстановлены).";
  if (e.type == "biography_detail") return "Биография места: " + p["label_ru"].str() + " (" + name_of(c, p["zone"].str()) + ", " + p["anchor"].str() + ").";
  if (e.type == "biography_rejected") return "Биография места: деталь " + p["detail_id"].str() + " не размещена (" + p["reason"].str() + ").";
  if (e.type == "invariant_violation") return "НАРУШЕНИЕ ИНВАРИАНТА: " + p["detail"].str();
  if (e.type == "debug_patch") return "Отладочное изменение мира.";
  return e.type;
}

}  // namespace echo
