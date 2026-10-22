#include "echo/sim.hpp"

#include <cmath>

#include "echo/admission.hpp"
#include "echo/authority.hpp"
#include "echo/director.hpp"
#include "echo/policy.hpp"
#include "echo/tasks.hpp"
#include "echo/world.hpp"

namespace echo {

void fire_trigger(Core& c, const ScriptedTrigger& t, double now_ms) {
  c.st.triggers_fired.insert(t.id);
  SensorState& s = c.st.sensors.at(t.sensor);
  s.reading = t.reading;  // instrument layer; s.truth is untouched
  s.fault = t.id;
  s.distortion.clear();
  bump_revision(c, {t.sensor});
  json::Value p = json::Value::object();
  p.set("trigger", t.id);
  p.set("sensor", t.sensor);
  json::Value r = json::Value::object();
  r.set("value", t.reading.value);
  r.set("trend", t.reading.trend);
  p.set("reading", r);
  emit(c, "trigger_fired", "", std::move(p), kSrcSim);
  c.st.emergency = true;
  c.st.emergency_lights = true;
  c.st.emergency_sensor = t.sensor;
  json::Value l = json::Value::object();
  l.set("on", true);
  emit(c, "emergency_lights", "", std::move(l), kSrcSim);
  director_on_emergency_start(c);
  for (const auto& rv : t.reveal) {
    for (const auto& to : rv.to) {
      if (!learn(c, to, rv.fact, rv.source)) continue;
      json::Value fp = json::Value::object();
      fp.set("to", to);
      fp.set("facts", json::Value::string_array({rv.fact}));
      fp.set("source", rv.source);
      emit(c, "facts_revealed", to, std::move(fp), kSrcSim);
    }
  }
  // NPCs inside the alarm zone react at once by rules (emergency requests never wait for a model).
  const std::string zone = c.data.home_zone_of(t.sensor);
  for (const auto& n : c.data.crew) {
    if (n.is_player || c.st.actors.at(n.id).zone != zone) continue;
    Situation sit;
    sit.origin = "emergency";
    sit.focus = t.sensor;
    sit.trigger_id = t.id;
    sit.text_ru = "Тревога прямо здесь: " + c.data.label(t.sensor) + " показывает падение давления.";
    enqueue_request(c, n.id, "emergency", sit, now_ms, false);
  }
  if (t.has_initiative) {
    Situation sit;
    sit.origin = "trigger";
    sit.focus = t.sensor;
    sit.trigger_id = t.id;
    sit.text_ru = t.initiative_situation_ru;
    enqueue_request(c, t.initiative_actor, t.initiative_kind, sit, now_ms, true);
  }
}

std::vector<std::string> sim_tick(Core& c, std::int64_t dt_ms, double now_ms) {
  c.st.last_now_ms = now_ms;
  std::vector<std::string> expired = expire_requests(c, now_ms);
  c.st.sim_ms += dt_ms;
  for (const auto& t : c.data.triggers) {
    if (c.st.triggers_fired.count(t.id) == 0 && c.st.sim_ms >= static_cast<std::int64_t>(std::llround(t.at_time_s * 1000.0))) {
      fire_trigger(c, t, now_ms);
    }
  }
  advance_tasks(c, dt_ms, now_ms);
  advance_walks(c, dt_ms);
  expire_plans(c, now_ms);
  update_activities(c);
  update_fatigue(c, dt_ms);
  director_tick(c, dt_ms, now_ms);
  observe(c, now_ms);
  update_activities(c);
  return expired;
}

}  // namespace echo
