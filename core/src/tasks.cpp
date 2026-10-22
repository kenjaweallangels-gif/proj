#include "echo/tasks.hpp"

#include <algorithm>
#include <cmath>

#include "echo/authority.hpp"
#include "echo/biography.hpp"
#include "echo/director.hpp"
#include "echo/policy.hpp"
#include "echo/rules.hpp"
#include "echo/speech.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

constexpr double kCompanionSpeedup = 0.8;  // a helper with tools shortens the work
constexpr double kRestRecovery = 0.4;

Travel make_travel(const Core& c, const std::string& from, const std::string& to) {
  Travel t;
  const Route r = find_route(c, from, to);
  if (r.ok) {
    t.path = r.zones;
    t.doors = r.doors;
  } else {
    t.path = {from};
  }
  return t;
}

// Advances along the path; returns false when the next door has become impassable.
bool step_travel(Core& c, Travel& tr, ActorState& a, std::int64_t dt) {
  while (dt > 0 && !tr.arrived()) {
    const std::string& door = tr.doors[tr.hop];
    if (c.st.doors.at(door).state == "sealed") return false;
    if (tr.hop_total_ms == 0) tr.hop_total_ms = hop_duration_ms(c, door);
    const std::int64_t need = tr.hop_total_ms - tr.hop_elapsed_ms;
    if (dt >= need) {
      dt -= need;
      tr.hop++;
      a.zone = tr.path[tr.hop];
      tr.hop_elapsed_ms = 0;
      tr.hop_total_ms = 0;
    } else {
      tr.hop_elapsed_ms += dt;
      dt = 0;
    }
  }
  return true;
}

std::string journal_kind(const std::string& action) {
  if (action == "inspect") return "inspect";
  if (action == "drone_survey") return "survey";
  if (action == "repair") return "repair";
  if (action == "prepare_isolation") return "isolation";
  if (action == "propose_rest") return "rest";
  if (action == "preserve_sample") return "sample";
  if (action == "prepare_rover") return "rover";
  return "";
}

void send_home(Core& c, const std::string& actor_id) {
  ActorState* a = actor(c, actor_id);
  if (a == nullptr || !a->task_id.empty() || a->zone == a->home_zone) return;
  a->walk = make_travel(c, a->zone, a->home_zone);
}

void release_task(Core& c, Task& t, bool consume) {
  std::vector<std::string> touched{t.actor, t.companion};
  for (const auto& [res, amount] : t.reserved) {
    ResourceState& r = c.st.resources[res];
    r.reserved -= amount;
    if (std::fabs(r.reserved) < 1e-9) r.reserved = 0.0;
    if (consume) {
      r.amount -= amount;
      json::Value p = json::Value::object();
      p.set("resource", res);
      p.set("amount", amount);
      p.set("left", r.amount);
      p.set("task_id", t.id);
      emit(c, "resource_consumed", t.actor, std::move(p), kSrcSim);
    }
    touched.push_back(res);
  }
  for (const auto& tool : t.tools) {
    if (c.st.items[tool].lock == t.id) c.st.items[tool].lock.clear();
    touched.push_back(tool);
  }
  for (const std::string* who : {&t.actor, &t.companion}) {
    if (ActorState* a = actor(c, *who); a != nullptr && a->task_id == t.id) a->task_id.clear();
  }
  bump_revision(c, touched);
}

// Reveals inspection facts to the inspectors; returns them ordered physical layer first.
std::vector<std::string> reveal_inspection(Core& c, Task& t) {
  std::vector<std::string> facts = inspection_facts(c, t.target);
  std::stable_sort(facts.begin(), facts.end(), [&](const std::string& a, const std::string& b) {
    return (c.data.fact(a)->layer == "physical") > (c.data.fact(b)->layer == "physical");
  });
  const std::string source = "observation:" + t.target;
  for (const std::string* who : {&t.actor, &t.companion}) {
    if (who->empty()) continue;
    std::vector<std::string> got;
    for (const auto& f : facts) {
      reconfirm(c, *who, f, source);
      got.push_back(f);
    }
    if (!got.empty()) {
      json::Value p = json::Value::object();
      p.set("to", *who);
      p.set("facts", json::Value::string_array(got));
      p.set("source", source);
      emit(c, "facts_revealed", *who, std::move(p), kSrcSim);
    }
  }
  // Director interpretations about this zone become checked facts only now (Документ §13).
  const std::string zone = zone_of_entity(c, t.target);
  bool resolved_interpretation = false;
  for (const auto& [actor_id, mem] : c.st.memory) {
    for (const auto& k : mem.facts) {
      const FactDef* f = c.data.fact(k.fact);
      if (f != nullptr && f->layer == "interpretation" && contains(f->about, zone)) resolved_interpretation = true;
    }
  }
  if (resolved_interpretation) {
    for (const std::string* who : {&t.actor, &t.companion}) {
      if (who->empty()) continue;
      remember(c, *who, "episode",
               "Проверено на месте: " + c.data.label(zone) + " — источник услышанного не подтвердился, отсек пуст.",
               "observation:" + zone, 0.7, {zone});
    }
  }
  if (facts.empty()) {
    remember(c, t.actor, "episode", "Осмотр «" + c.data.label(t.target) + "»: отклонений не найдено.",
             "observation:" + t.target, 0.4, {t.target});
  }
  return facts;
}

void complete_task(Core& c, const std::string& task_id, double now_ms) {
  Task& t = c.st.tasks.at(task_id);
  const ActionDef& a = *c.data.action(t.action);
  std::vector<std::string> revealed;
  json::Value results = json::Value::object();
  for (const auto& effect : a.effects) {
    if (effect == "reveal_inspection") {
      revealed = reveal_inspection(c, t);
      results.set("revealed", json::Value::string_array(revealed));
    } else if (effect == "clear_sensor_fault") {
      // Calibration on site shows what the inspection would have shown, then restores the instrument layer.
      std::vector<std::string> facts = inspection_facts(c, t.target);
      for (const auto& f : facts) {
        reconfirm(c, t.actor, f, "observation:" + t.target);
        if (!t.companion.empty()) reconfirm(c, t.companion, f, "observation:" + t.target);
        append_unique(revealed, f);
      }
      SensorState& s = c.st.sensors.at(t.target);
      s.reading = s.truth;
      s.fault.clear();
      s.distortion.clear();
      bump_revision(c, {t.target});
      json::Value p = json::Value::object();
      p.set("sensor", t.target);
      p.set("reading", json::Value::object());
      emit(c, "sensor_repaired", t.actor, std::move(p), kSrcSim);
      if (c.st.emergency && c.st.emergency_sensor == t.target) {
        c.st.emergency = false;
        c.st.emergency_lights = false;
        c.st.emergency_sensor.clear();
        json::Value l = json::Value::object();
        l.set("on", false);
        emit(c, "emergency_lights", "", std::move(l), kSrcSim);
        director_on_emergency_end(c);
      }
      results.set("repaired", t.target);
    } else if (effect == "seal_zone") {
      std::vector<std::string> doors;
      for (const auto& d : c.data.doors) {
        if (d.a == t.target || d.b == t.target) {
          c.st.doors[d.id].state = "sealed";
          doors.push_back(d.id);
        }
      }
      c.st.sealed_zones.insert(t.target);
      std::vector<std::string> touched = doors;
      touched.push_back(t.target);
      bump_revision(c, touched);
      json::Value p = json::Value::object();
      p.set("zone", t.target);
      p.set("doors", json::Value::string_array(doors));
      emit(c, "zone_sealed", t.actor, std::move(p), kSrcSim);
      results.set("sealed", t.target);
    } else if (effect == "share_facts") {
      std::vector<std::string> learned;
      for (const auto& f : t.fact_ids) {
        if (learn(c, c.data.player_id, f, "reported_by:" + t.actor)) learned.push_back(f);
      }
      if (!learned.empty()) {
        json::Value p = json::Value::object();
        p.set("to", c.data.player_id);
        p.set("facts", json::Value::string_array(learned));
        p.set("source", "reported_by:" + t.actor);
        emit(c, "facts_revealed", t.actor, std::move(p), kSrcSim);
      }
    } else if (effect == "rest") {
      ActorState& ex = c.st.actors.at(t.actor);
      ex.fatigue = std::max(0.0, ex.fatigue - kRestRecovery);
      if (t.proposer != t.actor) {
        ex.relationships[t.proposer] = clamp01(ex.relationships[t.proposer] + 0.02);
        remember(c, t.actor, "episode", "Отдых по настоянию " + c.data.speech.names.at(t.proposer).gen + " пошёл на пользу.",
                 "event:task:" + t.id, 0.45, {t.proposer});
      }
      results.set("fatigue", ex.fatigue);
    } else if (effect == "rover_ready") {
      c.st.items.at(t.target).ready = true;
      bump_revision(c, {t.target});
      results.set("ready", t.target);
    } else if (effect == "preserve_sample") {
      c.st.items.at(t.target).preserved = true;
      bump_revision(c, {t.target});
      results.set("preserved", t.target);
    }
  }
  release_task(c, t, true);
  t.state = "done";
  t.phase = "done";
  t.finished_ms = c.st.sim_ms;
  json::Value p = json::Value::object();
  p.set("task_id", t.id);
  p.set("action", t.action);
  p.set("target", t.target);
  p.set("companion", t.companion);
  p.set("proposer", t.proposer);
  p.set("results", results);
  p.set("instant", a.instant());
  emit(c, "task_completed", t.actor, std::move(p), kSrcSim);

  // Place biography: the module journal remembers who worked here and what was done.
  const std::string kind = journal_kind(t.action);
  if (!kind.empty()) {
    biography_record(c, t.work_zone, kind, t, "");
    if (!t.companion.empty()) biography_record(c, t.work_zone, "work_together", t, "");
    for (const auto& tool : t.tools) biography_record(c, c.data.item(tool)->zone, "tool_used", t, tool);
  }

  // A completion line (only for real work; instant actions already spoke when accepted).
  if (!a.instant()) {
    SpeechRequest req;
    req.actor = t.actor;
    req.stage = "done";
    req.action = t.action;
    req.style = t.style;
    req.target = t.target;
    req.companion = t.companion;
    req.fact_ids = revealed;
    req.result_fact = revealed.empty() ? "" : revealed.front();
    req.situation = c.st.emergency ? "alarm" : "calm";
    Speech s = render_speech(c, req);
    if (s.template_id != "core.minimal") {
      say(c, s, kSrcSim);
      // What is said aloud to the commander becomes his knowledge, with the speaker as the source.
      std::vector<std::string> learned;
      for (const auto& f : s.fact_ids) {
        if (learn(c, c.data.player_id, f, "reported_by:" + t.actor)) learned.push_back(f);
      }
      if (!learned.empty()) {
        json::Value fp = json::Value::object();
        fp.set("to", c.data.player_id);
        fp.set("facts", json::Value::string_array(learned));
        fp.set("source", "reported_by:" + t.actor);
        emit(c, "facts_revealed", t.actor, std::move(fp), kSrcSim);
      }
    }
  }
  const Task done = t;  // copy: follow-ups may start new tasks and rehash the map
  send_home(c, done.actor);
  if (!done.companion.empty()) send_home(c, done.companion);
  audit_invariants(c, "complete " + done.id);
  on_task_completed(c, done, revealed, now_ms);
}

}  // namespace

double Task::progress() const {
  if (state == "done") return 1.0;
  if (phase == "work" && work_total_ms > 0) return std::min(1.0, static_cast<double>(work_ms) / static_cast<double>(work_total_ms));
  return 0.0;
}

std::vector<std::string> inspection_facts(const Core& c, const std::string& target) {
  std::vector<std::string> out;
  for (const auto& ir : c.data.inspection_reveals) {
    if (ir.target != target) continue;
    if (ir.condition == "sensor_fault_active" && !sensor_fault_active(c, target)) continue;
    for (const auto& f : ir.reveal) {
      const FactDef* fd = c.data.fact(f);
      if (fd != nullptr && !fd->is_protected) append_unique(out, f);
    }
  }
  return out;
}

std::string start_task(Core& c, const TaskSpec& spec, double now_ms) {
  const ActionDef& a = *c.data.action(spec.action);
  Task t;
  t.id = format_id("task-", c.st.next_task++, 4);
  t.action = spec.action;
  t.actor = spec.executor;
  t.companion = spec.companion;
  t.target = spec.target;
  t.proposer = spec.proposer;
  t.origin = spec.origin;
  t.source = spec.source;
  t.style = spec.style;
  t.gesture = spec.gesture;
  t.fact_ids = spec.fact_ids;
  t.started_ms = c.st.sim_ms;
  std::vector<std::string> touched{t.actor, t.companion, t.proposer};
  if (!spec.from_plan.empty()) {
    // Take over the plan's soft reservation: nothing is reserved (or spent) twice.
    Plan& plan = c.st.plans.at(spec.from_plan);
    t.reserved = plan.reserved;
    t.tools = plan.tools;
    for (const auto& tool : t.tools) c.st.items[tool].lock = t.id;
  } else {
    for (const auto& [res, amount] : a.consumes) {
      c.st.resources[res].reserved += amount;
      t.reserved.emplace_back(res, amount);
    }
    for (const auto& tool : a.tools) {
      c.st.items[tool].lock = t.id;
      t.tools.push_back(tool);
    }
  }
  for (const auto& [res, amount] : t.reserved) touched.push_back(res);
  for (const auto& tool : t.tools) touched.push_back(tool);
  ActorState& ex = c.st.actors.at(t.actor);
  if (!a.instant()) {
    // Instant actions (a word, a refusal) never occupy the actor: they may be said while busy.
    ex.task_id = t.id;
    ex.walk = Travel{};
  }
  if (!t.companion.empty() && !a.instant()) {
    ActorState& comp = c.st.actors.at(t.companion);
    comp.task_id = t.id;
    comp.walk = Travel{};
    if (comp.soft_plan == spec.from_plan) comp.soft_plan.clear();
  }
  c.st.actors.at(t.proposer).cooldown_until_ms[a.id] = c.st.sim_ms + static_cast<std::int64_t>(std::llround(a.cooldown_s * 1000.0));
  t.work_zone = work_zone_for(c, a, t.actor, t.target);
  if (is_remote_action(a)) {
    t.travel.path = {ex.zone};
  } else {
    t.travel = make_travel(c, ex.zone, t.work_zone);
  }
  if (!t.companion.empty()) t.companion_travel = make_travel(c, c.st.actors.at(t.companion).zone, t.work_zone);
  else t.companion_travel.path = {t.work_zone};
  double work = a.duration_s * 1000.0;
  if (!t.companion.empty() && !a.tools.empty()) work *= kCompanionSpeedup;
  t.work_total_ms = static_cast<std::int64_t>(std::llround(work));
  t.phase = t.travel.arrived() && t.companion_travel.arrived() ? "work" : "travel";
  bump_revision(c, touched);
  const std::string id = t.id;
  json::Value p = json::Value::object();
  p.set("task_id", id);
  p.set("action", t.action);
  p.set("target", t.target);
  p.set("companion", t.companion);
  p.set("proposer", t.proposer);
  p.set("path", json::Value::string_array(t.travel.path));
  p.set("work_s", static_cast<double>(t.work_total_ms) / 1000.0);
  p.set("instant", a.instant());
  c.st.tasks[id] = std::move(t);
  emit(c, "task_started", c.st.tasks.at(id).actor, std::move(p), spec.source);
  if (a.instant()) complete_task(c, id, now_ms);
  return id;
}

void advance_tasks(Core& c, std::int64_t dt_ms, double now_ms) {
  std::vector<std::string> ids;
  for (const auto& [id, t] : c.st.tasks) {
    if (t.state == "active") ids.push_back(id);
  }
  for (const auto& id : ids) {
    Task& t = c.st.tasks.at(id);
    if (t.state != "active") continue;
    if (t.phase == "travel") {
      bool ok = step_travel(c, t.travel, c.st.actors.at(t.actor), dt_ms);
      if (ok && !t.companion.empty()) ok = step_travel(c, t.companion_travel, c.st.actors.at(t.companion), dt_ms);
      if (!ok) {
        // A door on the way was sealed: try another route, otherwise the task fails without effects.
        t.travel = make_travel(c, c.st.actors.at(t.actor).zone, t.work_zone);
        if (!t.companion.empty()) t.companion_travel = make_travel(c, c.st.actors.at(t.companion).zone, t.work_zone);
        if (t.travel.path.back() != t.work_zone || t.companion_travel.path.back() != t.work_zone) {
          release_task(c, t, false);
          t.state = "failed";
          t.finished_ms = c.st.sim_ms;
          json::Value p = json::Value::object();
          p.set("task_id", t.id);
          p.set("reason", "route_blocked");
          emit(c, "task_failed", t.actor, std::move(p), kSrcSim);
          continue;
        }
      }
      if (t.travel.arrived() && t.companion_travel.arrived()) {
        t.phase = "work";
        json::Value p = json::Value::object();
        p.set("task_id", t.id);
        p.set("zone", t.work_zone);
        p.set("companion", t.companion);
        emit(c, "task_work_started", t.actor, std::move(p), kSrcSim);
      }
    } else if (t.phase == "work") {
      t.work_ms += dt_ms;
      if (t.work_ms >= t.work_total_ms) complete_task(c, id, now_ms);
    }
  }
}

bool cancel_task(Core& c, const std::string& task_id, const std::string& reason) {
  const auto it = c.st.tasks.find(task_id);
  if (it == c.st.tasks.end() || it->second.state != "active") return false;
  Task& t = it->second;
  release_task(c, t, false);
  t.state = "cancelled";
  t.finished_ms = c.st.sim_ms;
  json::Value p = json::Value::object();
  p.set("task_id", task_id);
  p.set("reason", reason);
  emit(c, "task_cancelled", t.actor, std::move(p), kSrcPlayer);
  send_home(c, t.actor);
  if (!t.companion.empty()) send_home(c, t.companion);
  audit_invariants(c, "cancel " + task_id);
  return true;
}

void advance_walks(Core& c, std::int64_t dt_ms) {
  for (auto& [id, a] : c.st.actors) {
    if (!a.task_id.empty() || a.walk.path.empty()) continue;
    if (!step_travel(c, a.walk, a, dt_ms) || a.walk.arrived()) a.walk = Travel{};
  }
}

void update_activities(Core& c) {
  for (auto& [id, a] : c.st.actors) {
    std::string activity = "idle";
    if (!a.task_id.empty()) {
      const Task& t = c.st.tasks.at(a.task_id);
      const Travel& tr = id == t.actor ? t.travel : t.companion_travel;
      if (t.phase == "travel" && !tr.arrived()) activity = "walking";
      else if (id == t.actor && t.action == "propose_rest") activity = "resting";
      else activity = "working";
    } else if (!a.walk.path.empty() && !a.walk.arrived()) {
      activity = "walking";
    }
    if (a.talking_until_ms > c.st.sim_ms && activity == "idle") activity = "talking";
    if (a.talking_until_ms <= c.st.sim_ms && a.gesture != "none") a.gesture = "none";
    a.activity = activity;
  }
}

void update_fatigue(Core& c, std::int64_t dt_ms) {
  const double s = static_cast<double>(dt_ms) / 1000.0;
  for (auto& [id, a] : c.st.actors) {
    if (!is_npc(c, id)) continue;
    double delta = 0.0;
    if (a.activity == "working") delta = 0.00025 * s + (zone_requires_suit(c, a.zone) ? 0.0004 * s : 0.0);
    else if (a.activity == "walking") delta = 0.0001 * s;
    else if (a.activity == "idle" || a.activity == "talking") delta = -0.00002 * s;
    a.fatigue = clamp01(a.fatigue + delta);
  }
}

}  // namespace echo
