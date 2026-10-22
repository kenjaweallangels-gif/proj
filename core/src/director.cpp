#include "echo/director.hpp"

#include <algorithm>
#include <cmath>

#include "echo/admission.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

std::int64_t to_ms(double s) { return static_cast<std::int64_t>(std::llround(s * 1000.0)); }

bool witness_idle(const Core& c, const std::string& id) {
  const ActorState* a = actor(c, id);
  if (a == nullptr || !a->task_id.empty() || !a->plan_id.empty() || !a->soft_plan.empty() || a->debug_busy) return false;
  for (const auto& q : c.st.queue) {
    if (q.actor == id) return false;
  }
  for (const auto& [rid, r] : c.st.requests) {
    if (r.actor == id && r.state == "pending") return false;
  }
  return true;
}

bool anyone_knows(const Core& c, const std::string& fact) {
  for (const auto& [id, mem] : c.st.memory) {
    for (const auto& k : mem.facts) {
      if (k.fact == fact) return true;
    }
  }
  return false;
}

}  // namespace

std::string director_check(const Core& c, const DirectorEventDef& ev, std::string& witness) {
  witness.clear();
  const DirectorData& dd = c.data.director;
  const std::int64_t now = c.st.sim_ms;
  const DirectorState& ds = c.st.director;
  if (now < to_ms(ev.window_from_s) || now > to_ms(ev.window_to_s)) return "story_window";
  if (ev.no_emergency && c.st.emergency) return "emergency";
  if (now < ds.calm_until_ms) return "calm_window";
  if (ds.last_event_ms >= 0 && now - ds.last_event_ms < to_ms(dd.min_gap_s)) return "min_gap";
  if (const auto it = ds.cooldown_until_ms.find(ev.id); it != ds.cooldown_until_ms.end() && it->second > now) return "cooldown";
  for (const auto& other : ev.incompatible) {
    const auto it = ds.last_fired_ms.find(other);
    if (it != ds.last_fired_ms.end() && now - it->second < to_ms(ev.cooldown_s)) return "incompatible:" + other;
  }
  if (ds.tension > ev.max_tension_before || ds.tension + ev.tension_cost > dd.max_tension) return "tension";
  for (const auto& [id, t] : c.st.tasks) {
    if (t.state == "active" && contains(dd.emergency_task_actions, t.action) && contains(ev.no_task_near, t.work_zone)) {
      return "emergency_task_near";
    }
  }
  if (contains(ev.tags, "echo") && now - ds.last_echo_ms < to_ms(ev.min_since_last_echo_s)) return "echo_too_recent";
  if (!ev.zone_checked.empty()) {
    bool checked = anyone_knows(c, ev.zone_checked_fact);
    const auto j = c.st.journals.find(ev.zone_checked);
    if (j != c.st.journals.end()) {
      for (const auto& e : j->second) checked = checked || e.kind == "inspect" || e.kind == "survey";
    }
    if (!checked) return "zone_not_checked";
  }
  for (const auto& req : ev.requires_facts) {
    if (req.holder == "player" && !knows(c, c.data.player_id, req.fact)) return "player_lacks:" + req.fact;
    if (req.holder == "any" && !anyone_knows(c, req.fact)) return "nobody_knows:" + req.fact;
  }
  if (!ev.witness_candidates.empty()) {
    for (const auto& cand : ev.witness_candidates) {
      const ActorState* a = actor(c, cand);
      if (a == nullptr) continue;
      if (!ev.witness_zones.empty() && !contains(ev.witness_zones, a->zone)) continue;
      if (ev.witness_idle && !witness_idle(c, cand)) continue;
      bool facts_ok = true;
      for (const auto& req : ev.requires_facts) {
        if (req.holder == "witness" && !knows(c, cand, req.fact)) facts_ok = false;
      }
      if (!facts_ok) continue;
      witness = cand;
      break;
    }
    if (witness.empty()) return "no_witness";
  }
  return "";
}

void director_fire(Core& c, const DirectorEventDef& ev, const std::string& witness, double now_ms) {
  DirectorState& ds = c.st.director;
  const std::int64_t now = c.st.sim_ms;
  ds.tension = std::min(1.0, ds.tension + ev.tension_cost);
  ds.last_event = ev.id;
  ds.last_event_ms = now;
  ds.cooldown_until_ms[ev.id] = now + to_ms(ev.cooldown_s);
  ds.last_fired_ms[ev.id] = now;
  ds.fired.push_back(ev.id);
  if (contains(ev.tags, "echo")) ds.last_echo_ms = now;
  json::Value effects = json::Value::array();
  for (const auto& ef : ev.effects) {
    json::Value e = json::Value::object();
    e.set("type", ef.type);
    if (ef.type == "sound") {
      e.set("zone", ef.zone);
      e.set("cue", ef.cue);
      json::Value p = json::Value::object();
      p.set("event", ev.id);
      p.set("zone", ef.zone);
      p.set("cue", ef.cue);
      p.set("text_ru", ef.text_ru);
      p.set("witness", witness);
      emit(c, "director_sound", witness, std::move(p), kSrcDirector);
    } else if (ef.type == "instrument_distortion") {
      // Instrument layer only: the reading lies for a while, the physical truth stays untouched.
      SensorState& s = c.st.sensors.at(ef.sensor);
      if (!s.fault.empty()) continue;  // never mask or alter a real fault
      s.reading = Reading{ef.value, ef.trend};
      s.distortion = ev.id;
      s.distortion_until_ms = now + to_ms(ef.duration_s);
      bump_revision(c, {ef.sensor});
      e.set("sensor", ef.sensor);
      e.set("cue", ef.cue);
      json::Value r = json::Value::object();
      r.set("value", ef.value);
      r.set("trend", ef.trend);
      e.set("reading", r);
    } else if (ef.type == "interpretation") {
      if (witness.empty()) continue;
      if (!ef.fact.empty()) learn(c, witness, ef.fact, ef.source);
      std::vector<std::string> tags;
      if (!ef.fact.empty()) tags = c.data.fact(ef.fact)->about;
      tags.push_back("interpretation");
      remember(c, witness, "opinion", ef.text_ru, ef.source, 0.55, tags, ef.confidence);
      e.set("holder", witness);
      e.set("fact", ef.fact);
    }
    effects.push(e);
  }
  json::Value p = json::Value::object();
  p.set("event", ev.id);
  p.set("label_ru", ev.label_ru);
  p.set("level", ev.level);
  p.set("witness", witness);
  p.set("tension", ds.tension);
  p.set("effects", effects);
  emit(c, "director_event", witness, std::move(p), kSrcDirector);
  if (ev.has_initiative && !witness.empty()) {
    Situation sit;
    sit.origin = "director";
    sit.focus = ev.initiative_focus;
    sit.trigger_id = ev.id;
    sit.text_ru = ev.initiative_situation_ru;
    enqueue_request(c, witness, "initiative", sit, now_ms, false);
  }
}

void director_tick(Core& c, std::int64_t dt_ms, double now_ms) {
  const DirectorData& dd = c.data.director;
  DirectorState& ds = c.st.director;
  ds.tension = std::max(0.0, ds.tension - dd.decay_per_s * static_cast<double>(dt_ms) / 1000.0);
  // Safe recovery of temporary instrument distortions.
  for (auto& [id, s] : c.st.sensors) {
    if (s.distortion.empty() || s.distortion_until_ms > c.st.sim_ms) continue;
    const std::string ev = s.distortion;
    s.distortion.clear();
    if (s.fault.empty()) s.reading = s.truth;
    bump_revision(c, {id});
    json::Value p = json::Value::object();
    p.set("event", ev);
    p.set("sensor", id);
    emit(c, "director_recovered", "", std::move(p), kSrcDirector);
  }
  if (c.st.sim_ms < ds.next_eval_ms) return;
  ds.next_eval_ms = c.st.sim_ms + to_ms(dd.evaluate_every_s);
  if (c.st.emergency || c.st.sim_ms < ds.calm_until_ms) return;
  for (const auto& ev : dd.events) {
    std::string witness;
    if (!director_check(c, ev, witness).empty()) continue;
    if (c.st.rng.next_double() < ev.chance) {
      director_fire(c, ev, witness, now_ms);
      return;  // at most one event per evaluation
    }
  }
}

void director_on_emergency_start(Core& c) {
  c.st.director.tension = std::max(c.st.director.tension, c.data.director.emergency_tension);
}

void director_on_emergency_end(Core& c) {
  // The player just lived through an alarm: give time to look around and talk (Документ §13).
  c.st.director.calm_until_ms = c.st.sim_ms + to_ms(c.data.director.calm_window_s);
}

json::Value director_json(const Core& c) {
  const DirectorState& ds = c.st.director;
  json::Value v = json::Value::object();
  v.set("tension", ds.tension);
  v.set("last_event", ds.last_event.empty() ? json::Value() : json::Value(ds.last_event));
  json::Value cd = json::Value::object();
  for (const auto& [id, until] : ds.cooldown_until_ms) {
    if (until > c.st.sim_ms) cd.set(id, static_cast<double>(until - c.st.sim_ms) / 1000.0);
  }
  v.set("cooldowns", cd);
  v.set("calm_remaining_s", std::max(0.0, static_cast<double>(ds.calm_until_ms - c.st.sim_ms) / 1000.0));
  v.set("fired", json::Value::string_array(ds.fired));
  return v;
}

}  // namespace echo
