#include "echo/persist.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "echo/admission.hpp"
#include "echo/biography.hpp"
#include "echo/context.hpp"
#include "echo/director.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

using json::Value;

Value num(std::int64_t v) { return Value(static_cast<double>(v)); }
Value num_u(std::uint64_t v) { return Value(static_cast<double>(v)); }
Value strs(const std::vector<std::string>& v) { return Value::string_array(v); }

Value reading_to(const Reading& r) {
  Value v = Value::object();
  v.set("value", r.value);
  v.set("trend", r.trend);
  return v;
}

Value proposal_to(const Proposal& p) {
  Value v = Value::object();
  v.set("action", p.action);
  v.set("target", p.target);
  v.set("companion", p.companion);
  v.set("style", p.style);
  v.set("gesture", p.gesture);
  v.set("fact_ids", strs(p.fact_ids));
  return v;
}

Value situation_to(const Situation& s) {
  Value v = Value::object();
  v.set("origin", s.origin);
  v.set("text_ru", s.text_ru);
  v.set("utterance", s.utterance);
  v.set("say_intent", s.say_intent);
  v.set("focus", s.focus);
  v.set("trigger_id", s.trigger_id);
  v.set("has_order", s.has_order);
  v.set("order", proposal_to(s.order));
  v.set("no_approval", s.no_approval);
  return v;
}

Value travel_to(const Travel& t) {
  Value v = Value::object();
  v.set("path", strs(t.path));
  v.set("doors", strs(t.doors));
  v.set("hop", static_cast<double>(t.hop));
  v.set("hop_elapsed_ms", num(t.hop_elapsed_ms));
  v.set("hop_total_ms", num(t.hop_total_ms));
  return v;
}

Value pairs_to(const std::vector<std::pair<std::string, double>>& p) {
  Value arr = Value::array();
  for (const auto& [k, d] : p) {
    Value e = Value::array();
    e.push(k);
    e.push(d);
    arr.push(e);
  }
  return arr;
}

// Strict reader for saves: any missing or mistyped field fails the whole load.
class In {
 public:
  std::string error;

  bool ok() const { return error.empty(); }
  void fail(const std::string& where) {
    if (error.empty()) error = where;
  }
  const Value& f(const Value& o, const char* k) {
    const Value* v = o.find(k);
    if (v == nullptr) {
      fail(std::string("нет поля ") + k);
      return null_;
    }
    return *v;
  }
  std::string s(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_string()) fail(std::string("ожидалась строка: ") + k);
    return v.as_string();
  }
  double n(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_number()) fail(std::string("ожидалось число: ") + k);
    return v.as_number();
  }
  std::int64_t i(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_integer()) fail(std::string("ожидалось целое: ") + k);
    return v.as_int();
  }
  bool b(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_bool()) fail(std::string("ожидалось true/false: ") + k);
    return v.as_bool();
  }
  const Value& a(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_array()) fail(std::string("ожидался массив: ") + k);
    return v;
  }
  const Value& obj(const Value& o, const char* k) {
    const Value& v = f(o, k);
    if (!v.is_object()) fail(std::string("ожидался объект: ") + k);
    return v;
  }
  std::vector<std::string> sa(const Value& o, const char* k) {
    std::vector<std::string> out;
    for (const auto& item : a(o, k).items()) {
      if (!item.is_string()) fail(std::string("ожидались строки: ") + k);
      out.push_back(item.as_string());
    }
    return out;
  }
  Reading reading(const Value& o, const char* k) {
    const Value& v = obj(o, k);
    return Reading{n(v, "value"), s(v, "trend")};
  }
  Proposal proposal(const Value& o, const char* k) {
    const Value& v = obj(o, k);
    Proposal p;
    p.action = s(v, "action");
    p.target = s(v, "target");
    p.companion = s(v, "companion");
    p.style = s(v, "style");
    p.gesture = s(v, "gesture");
    p.fact_ids = sa(v, "fact_ids");
    return p;
  }
  Situation situation(const Value& o, const char* k) {
    const Value& v = obj(o, k);
    Situation s_;
    s_.origin = s(v, "origin");
    s_.text_ru = s(v, "text_ru");
    s_.utterance = s(v, "utterance");
    s_.say_intent = s(v, "say_intent");
    s_.focus = s(v, "focus");
    s_.trigger_id = s(v, "trigger_id");
    s_.has_order = b(v, "has_order");
    s_.order = proposal(v, "order");
    s_.no_approval = b(v, "no_approval");
    return s_;
  }
  Travel travel(const Value& o, const char* k) {
    const Value& v = obj(o, k);
    Travel t;
    t.path = sa(v, "path");
    t.doors = sa(v, "doors");
    t.hop = static_cast<std::size_t>(i(v, "hop"));
    t.hop_elapsed_ms = i(v, "hop_elapsed_ms");
    t.hop_total_ms = i(v, "hop_total_ms");
    if (t.hop >= std::max<std::size_t>(1, t.path.size()) && !t.path.empty()) fail("неверный индекс пути");
    return t;
  }
  std::vector<std::pair<std::string, double>> pairs(const Value& o, const char* k) {
    std::vector<std::pair<std::string, double>> out;
    for (const auto& item : a(o, k).items()) {
      if (!item.is_array() || item.size() != 2 || !item.at(0).is_string() || !item.at(1).is_number()) {
        fail(std::string("ожидались пары: ") + k);
        break;
      }
      out.emplace_back(item.at(0).as_string(), item.at(1).as_number());
    }
    return out;
  }

 private:
  Value null_;
};

std::string target_zone_of(const Core& c, const ActorState& a) {
  if (!a.task_id.empty()) return c.st.tasks.at(a.task_id).work_zone;
  if (!a.walk.path.empty()) return a.walk.path.back();
  return "";
}

}  // namespace

Value state_to_json(const State& st) { return state_to_json(st, true); }

Value state_to_json(const State& st, bool with_events) {
  Value v = Value::object();
  v.set("seed", num_u(st.seed));
  v.set("rng", hex64(st.rng.state()));
  v.set("sim_ms", num(st.sim_ms));
  v.set("revision", num(st.revision));
  Value er = Value::object();
  for (const auto& [k, r] : st.entity_rev) er.set(k, num(r));
  v.set("entity_rev", er);
  Value doors = Value::object();
  for (const auto& [k, d] : st.doors) doors.set(k, d.state);
  v.set("doors", doors);
  Value res = Value::object();
  for (const auto& [k, r] : st.resources) {
    Value e = Value::object();
    e.set("amount", r.amount);
    e.set("reserved", r.reserved);
    res.set(k, e);
  }
  v.set("resources", res);
  Value items = Value::object();
  for (const auto& [k, it] : st.items) {
    Value e = Value::object();
    e.set("zone", it.zone);
    e.set("lock", it.lock);
    e.set("preserved", it.preserved);
    e.set("ready", it.ready);
    items.set(k, e);
  }
  v.set("items", items);
  Value sensors = Value::object();
  for (const auto& [k, s] : st.sensors) {
    Value e = Value::object();
    e.set("truth", reading_to(s.truth));
    e.set("reading", reading_to(s.reading));
    e.set("fault", s.fault);
    e.set("distortion", s.distortion);
    e.set("distortion_until_ms", num(s.distortion_until_ms));
    sensors.set(k, e);
  }
  v.set("sensors", sensors);
  v.set("sealed_zones", strs(std::vector<std::string>(st.sealed_zones.begin(), st.sealed_zones.end())));
  Value actors = Value::object();
  for (const auto& [k, a] : st.actors) {
    Value e = Value::object();
    e.set("zone", a.zone);
    e.set("home_zone", a.home_zone);
    e.set("task_id", a.task_id);
    e.set("plan_id", a.plan_id);
    e.set("soft_plan", a.soft_plan);
    e.set("activity", a.activity);
    e.set("fatigue", a.fatigue);
    e.set("health", a.health);
    e.set("trust_player", a.trust_player);
    Value rel = Value::object();
    for (const auto& [o, r] : a.relationships) rel.set(o, r);
    e.set("relationships", rel);
    Value cd = Value::object();
    for (const auto& [o, t] : a.cooldown_until_ms) cd.set(o, num(t));
    e.set("cooldown_until_ms", cd);
    e.set("gesture", a.gesture);
    e.set("style", a.style);
    e.set("talking_until_ms", num(a.talking_until_ms));
    e.set("debug_busy", a.debug_busy);
    e.set("walk", travel_to(a.walk));
    actors.set(k, e);
  }
  v.set("actors", actors);
  Value tasks = Value::object();
  for (const auto& [k, t] : st.tasks) {
    Value e = Value::object();
    e.set("action", t.action);
    e.set("actor", t.actor);
    e.set("companion", t.companion);
    e.set("target", t.target);
    e.set("proposer", t.proposer);
    e.set("origin", t.origin);
    e.set("source", t.source);
    e.set("state", t.state);
    e.set("phase", t.phase);
    e.set("work_zone", t.work_zone);
    e.set("travel", travel_to(t.travel));
    e.set("companion_travel", travel_to(t.companion_travel));
    e.set("work_ms", num(t.work_ms));
    e.set("work_total_ms", num(t.work_total_ms));
    e.set("started_ms", num(t.started_ms));
    e.set("finished_ms", num(t.finished_ms));
    e.set("fact_ids", strs(t.fact_ids));
    e.set("reserved", pairs_to(t.reserved));
    e.set("tools", strs(t.tools));
    e.set("style", t.style);
    e.set("gesture", t.gesture);
    tasks.set(k, e);
  }
  v.set("tasks", tasks);
  Value plans = Value::object();
  for (const auto& [k, p] : st.plans) {
    Value e = Value::object();
    e.set("actor", p.actor);
    e.set("request_id", p.request_id);
    e.set("source", p.source);
    e.set("state", p.state);
    e.set("proposal", proposal_to(p.proposal));
    e.set("situation", situation_to(p.situation));
    e.set("from_order", p.from_order);
    e.set("created_ms", num(p.created_ms));
    e.set("expires_ms", num(p.expires_ms));
    e.set("reserved", pairs_to(p.reserved));
    e.set("tools", strs(p.tools));
    e.set("world_task_id", p.world_task_id);
    plans.set(k, e);
  }
  v.set("plans", plans);
  Value queue = Value::array();
  for (const auto& q : st.queue) {
    Value e = Value::object();
    e.set("task_id", q.task_id);
    e.set("actor", q.actor);
    e.set("kind", q.kind);
    e.set("priority", q.priority);
    e.set("created_ms", q.created_ms);
    e.set("deadline_ms", q.deadline_ms);
    e.set("revision", num(q.revision));
    e.set("situation", situation_to(q.situation));
    queue.push(e);
  }
  v.set("queue", queue);
  Value reqs = Value::object();
  for (const auto& [k, r] : st.requests) {
    Value e = Value::object();
    e.set("actor", r.actor);
    e.set("kind", r.kind);
    e.set("backend", r.backend);
    e.set("state", r.state);
    e.set("resolution", r.resolution);
    e.set("created_ms", r.created_ms);
    e.set("dispatched_ms", r.dispatched_ms);
    e.set("deadline_ms", r.deadline_ms);
    e.set("world_revision", num(r.world_revision));
    e.set("situation", situation_to(r.situation));
    e.set("request", r.request);
    reqs.set(k, e);
  }
  v.set("requests", reqs);
  if (with_events) {
    Value events = Value::array();
    for (const auto& e : st.events) events.push(event_json(e));
    v.set("events", events);
  }
  Value memory = Value::object();
  for (const auto& [k, m] : st.memory) {
    Value e = Value::object();
    Value entries = Value::array();
    for (const auto& me : m.entries) {
      Value x = Value::object();
      x.set("id", me.id);
      x.set("kind", me.kind);
      x.set("text_ru", me.text_ru);
      x.set("source", me.source);
      x.set("fact_id", me.fact_id);
      x.set("confidence", me.confidence);
      x.set("importance", me.importance);
      x.set("time_ms", num(me.time_ms));
      x.set("tags", strs(me.tags));
      entries.push(x);
    }
    e.set("entries", entries);
    Value facts = Value::array();
    for (const auto& kf : m.facts) {
      Value x = Value::object();
      x.set("fact", kf.fact);
      x.set("source", kf.source);
      x.set("time_ms", num(kf.time_ms));
      facts.push(x);
    }
    e.set("facts", facts);
    memory.set(k, e);
  }
  v.set("memory", memory);
  Value dir = Value::object();
  dir.set("tension", st.director.tension);
  dir.set("last_event", st.director.last_event);
  dir.set("last_event_ms", num(st.director.last_event_ms));
  dir.set("next_eval_ms", num(st.director.next_eval_ms));
  dir.set("calm_until_ms", num(st.director.calm_until_ms));
  dir.set("last_echo_ms", num(st.director.last_echo_ms));
  Value cds = Value::object();
  for (const auto& [k, t] : st.director.cooldown_until_ms) cds.set(k, num(t));
  dir.set("cooldown_until_ms", cds);
  Value lf = Value::object();
  for (const auto& [k, t] : st.director.last_fired_ms) lf.set(k, num(t));
  dir.set("last_fired_ms", lf);
  dir.set("fired", strs(st.director.fired));
  v.set("director", dir);
  Value journals = Value::object();
  for (const auto& [zone, entries] : st.journals) {
    Value arr = Value::array();
    for (const auto& j : entries) {
      Value x = Value::object();
      x.set("t_ms", num(j.t_ms));
      x.set("kind", j.kind);
      x.set("actor", j.actor);
      x.set("companion", j.companion);
      x.set("task_id", j.task_id);
      x.set("action", j.action);
      x.set("detail", j.detail);
      arr.push(x);
    }
    journals.set(zone, arr);
  }
  v.set("journals", journals);
  Value bio = Value::array();
  for (const auto& p : st.biography) {
    Value x = Value::object();
    x.set("zone", p.zone);
    x.set("anchor", p.anchor);
    x.set("detail_id", p.detail_id);
    x.set("label_ru", p.label_ru);
    x.set("reason", p.reason);
    x.set("t_ms", num(p.t_ms));
    bio.push(x);
  }
  v.set("biography", bio);
  Value recent = Value::object();
  for (const auto& [k, d] : st.speech_recent) recent.set(k, strs(std::vector<std::string>(d.begin(), d.end())));
  v.set("speech_recent", recent);
  Value acc = Value::array();
  for (const auto& a : st.accepted) {
    Value x = Value::object();
    x.set("task_id", a.task_id);
    x.set("actor", a.actor);
    x.set("source", a.source);
    x.set("provider", a.provider);
    x.set("model", a.model);
    x.set("proposal_text", a.proposal_text);
    x.set("status", a.status);
    x.set("t_ms", num(a.t_ms));
    acc.push(x);
  }
  v.set("accepted_intents", acc);
  v.set("triggers_fired", strs(std::vector<std::string>(st.triggers_fired.begin(), st.triggers_fired.end())));
  Value obs = Value::object();
  for (const auto& [k, t] : st.observe_until_ms) obs.set(k, num(t));
  v.set("observe_until_ms", obs);
  v.set("emergency", st.emergency);
  v.set("emergency_lights", st.emergency_lights);
  v.set("emergency_sensor", st.emergency_sensor);
  v.set("next_ambient_ms", num(st.next_ambient_ms));
  Value counters = Value::object();
  counters.set("req", num_u(st.next_req));
  counters.set("plan", num_u(st.next_plan));
  counters.set("task", num_u(st.next_task));
  counters.set("seq", num_u(st.next_seq));
  counters.set("mem", num_u(st.next_mem));
  v.set("counters", counters);
  return v;
}

bool state_from_json(const Value& v, State& out, std::string& error) {
  In in;
  State st;
  if (!v.is_object()) {
    error = "state: ожидался объект";
    return false;
  }
  st.seed = static_cast<std::uint64_t>(in.i(v, "seed"));
  st.rng.set_state(std::strtoull(in.s(v, "rng").c_str(), nullptr, 16));
  st.sim_ms = in.i(v, "sim_ms");
  st.revision = in.i(v, "revision");
  for (const auto& m : in.obj(v, "entity_rev").members()) st.entity_rev[m.key] = m.value.as_int();
  for (const auto& m : in.obj(v, "doors").members()) st.doors[m.key] = DoorState{m.value.as_string()};
  for (const auto& m : in.obj(v, "resources").members()) st.resources[m.key] = ResourceState{in.n(m.value, "amount"), in.n(m.value, "reserved")};
  for (const auto& m : in.obj(v, "items").members()) {
    ItemState it;
    it.zone = in.s(m.value, "zone");
    it.lock = in.s(m.value, "lock");
    it.preserved = in.b(m.value, "preserved");
    it.ready = in.b(m.value, "ready");
    st.items[m.key] = it;
  }
  for (const auto& m : in.obj(v, "sensors").members()) {
    SensorState s;
    s.truth = in.reading(m.value, "truth");
    s.reading = in.reading(m.value, "reading");
    s.fault = in.s(m.value, "fault");
    s.distortion = in.s(m.value, "distortion");
    s.distortion_until_ms = in.i(m.value, "distortion_until_ms");
    st.sensors[m.key] = s;
  }
  for (const auto& z : in.sa(v, "sealed_zones")) st.sealed_zones.insert(z);
  for (const auto& m : in.obj(v, "actors").members()) {
    const Value& e = m.value;
    ActorState a;
    a.id = m.key;
    a.zone = in.s(e, "zone");
    a.home_zone = in.s(e, "home_zone");
    a.task_id = in.s(e, "task_id");
    a.plan_id = in.s(e, "plan_id");
    a.soft_plan = in.s(e, "soft_plan");
    a.activity = in.s(e, "activity");
    a.fatigue = in.n(e, "fatigue");
    a.health = in.n(e, "health");
    a.trust_player = in.n(e, "trust_player");
    for (const auto& r : in.obj(e, "relationships").members()) a.relationships[r.key] = r.value.as_number();
    for (const auto& r : in.obj(e, "cooldown_until_ms").members()) a.cooldown_until_ms[r.key] = r.value.as_int();
    a.gesture = in.s(e, "gesture");
    a.style = in.s(e, "style");
    a.talking_until_ms = in.i(e, "talking_until_ms");
    a.debug_busy = in.b(e, "debug_busy");
    a.walk = in.travel(e, "walk");
    st.actors[m.key] = a;
  }
  for (const auto& m : in.obj(v, "tasks").members()) {
    const Value& e = m.value;
    Task t;
    t.id = m.key;
    t.action = in.s(e, "action");
    t.actor = in.s(e, "actor");
    t.companion = in.s(e, "companion");
    t.target = in.s(e, "target");
    t.proposer = in.s(e, "proposer");
    t.origin = in.s(e, "origin");
    t.source = in.s(e, "source");
    t.state = in.s(e, "state");
    t.phase = in.s(e, "phase");
    t.work_zone = in.s(e, "work_zone");
    t.travel = in.travel(e, "travel");
    t.companion_travel = in.travel(e, "companion_travel");
    t.work_ms = in.i(e, "work_ms");
    t.work_total_ms = in.i(e, "work_total_ms");
    t.started_ms = in.i(e, "started_ms");
    t.finished_ms = in.i(e, "finished_ms");
    t.fact_ids = in.sa(e, "fact_ids");
    t.reserved = in.pairs(e, "reserved");
    t.tools = in.sa(e, "tools");
    t.style = in.s(e, "style");
    t.gesture = in.s(e, "gesture");
    st.tasks[m.key] = t;
  }
  for (const auto& m : in.obj(v, "plans").members()) {
    const Value& e = m.value;
    Plan p;
    p.id = m.key;
    p.actor = in.s(e, "actor");
    p.request_id = in.s(e, "request_id");
    p.source = in.s(e, "source");
    p.state = in.s(e, "state");
    p.proposal = in.proposal(e, "proposal");
    p.situation = in.situation(e, "situation");
    p.from_order = in.b(e, "from_order");
    p.created_ms = in.i(e, "created_ms");
    p.expires_ms = in.i(e, "expires_ms");
    p.reserved = in.pairs(e, "reserved");
    p.tools = in.sa(e, "tools");
    p.world_task_id = in.s(e, "world_task_id");
    st.plans[m.key] = p;
  }
  for (const auto& e : in.a(v, "queue").items()) {
    QueueItem q;
    q.task_id = in.s(e, "task_id");
    q.actor = in.s(e, "actor");
    q.kind = in.s(e, "kind");
    q.priority = static_cast<int>(in.i(e, "priority"));
    q.created_ms = in.n(e, "created_ms");
    q.deadline_ms = in.n(e, "deadline_ms");
    q.revision = in.i(e, "revision");
    q.situation = in.situation(e, "situation");
    st.queue.push_back(q);
  }
  for (const auto& m : in.obj(v, "requests").members()) {
    const Value& e = m.value;
    PendingRequest r;
    r.task_id = m.key;
    r.actor = in.s(e, "actor");
    r.kind = in.s(e, "kind");
    r.backend = in.s(e, "backend");
    r.state = in.s(e, "state");
    r.resolution = in.s(e, "resolution");
    r.created_ms = in.n(e, "created_ms");
    r.dispatched_ms = in.n(e, "dispatched_ms");
    r.deadline_ms = in.n(e, "deadline_ms");
    r.world_revision = in.i(e, "world_revision");
    r.situation = in.situation(e, "situation");
    r.request = in.obj(e, "request");
    st.requests[m.key] = r;
  }
  for (const auto& e : in.a(v, "events").items()) {
    Event ev;
    ev.seq = in.i(e, "seq");
    ev.t_ms = static_cast<std::int64_t>(std::llround(in.n(e, "t") * 1000.0));
    ev.rev = in.i(e, "rev");
    ev.type = in.s(e, "type");
    const Value& actor_v = in.f(e, "actor");
    ev.actor = actor_v.is_string() ? actor_v.as_string() : "";
    ev.source = in.s(e, "source");
    ev.payload = in.f(e, "payload");
    st.events.push_back(ev);
  }
  for (const auto& m : in.obj(v, "memory").members()) {
    ActorMemory am;
    for (const auto& x : in.a(m.value, "entries").items()) {
      MemoryEntry me;
      me.id = in.s(x, "id");
      me.kind = in.s(x, "kind");
      me.text_ru = in.s(x, "text_ru");
      me.source = in.s(x, "source");
      me.fact_id = in.s(x, "fact_id");
      me.confidence = in.n(x, "confidence");
      me.importance = in.n(x, "importance");
      me.time_ms = in.i(x, "time_ms");
      me.tags = in.sa(x, "tags");
      am.entries.push_back(me);
    }
    for (const auto& x : in.a(m.value, "facts").items()) am.facts.push_back(KnownFact{in.s(x, "fact"), in.s(x, "source"), in.i(x, "time_ms")});
    st.memory[m.key] = am;
  }
  const Value& dir = in.obj(v, "director");
  st.director.tension = in.n(dir, "tension");
  st.director.last_event = in.s(dir, "last_event");
  st.director.last_event_ms = in.i(dir, "last_event_ms");
  st.director.next_eval_ms = in.i(dir, "next_eval_ms");
  st.director.calm_until_ms = in.i(dir, "calm_until_ms");
  st.director.last_echo_ms = in.i(dir, "last_echo_ms");
  for (const auto& m : in.obj(dir, "cooldown_until_ms").members()) st.director.cooldown_until_ms[m.key] = m.value.as_int();
  for (const auto& m : in.obj(dir, "last_fired_ms").members()) st.director.last_fired_ms[m.key] = m.value.as_int();
  st.director.fired = in.sa(dir, "fired");
  for (const auto& m : in.obj(v, "journals").members()) {
    for (const auto& x : m.value.items()) {
      JournalEntry j;
      j.t_ms = in.i(x, "t_ms");
      j.kind = in.s(x, "kind");
      j.actor = in.s(x, "actor");
      j.companion = in.s(x, "companion");
      j.task_id = in.s(x, "task_id");
      j.action = in.s(x, "action");
      j.detail = in.s(x, "detail");
      st.journals[m.key].push_back(j);
    }
  }
  for (const auto& x : in.a(v, "biography").items()) {
    PlacedDetail p;
    p.zone = in.s(x, "zone");
    p.anchor = in.s(x, "anchor");
    p.detail_id = in.s(x, "detail_id");
    p.label_ru = in.s(x, "label_ru");
    p.reason = in.s(x, "reason");
    p.t_ms = in.i(x, "t_ms");
    st.biography.push_back(p);
  }
  for (const auto& m : in.obj(v, "speech_recent").members()) {
    for (const auto& id : m.value.items()) st.speech_recent[m.key].push_back(id.as_string());
  }
  for (const auto& x : in.a(v, "accepted_intents").items()) {
    AcceptedIntent a;
    a.task_id = in.s(x, "task_id");
    a.actor = in.s(x, "actor");
    a.source = in.s(x, "source");
    a.provider = in.s(x, "provider");
    a.model = in.s(x, "model");
    a.proposal_text = in.s(x, "proposal_text");
    a.status = in.s(x, "status");
    a.t_ms = in.i(x, "t_ms");
    st.accepted.push_back(a);
  }
  for (const auto& t : in.sa(v, "triggers_fired")) st.triggers_fired.insert(t);
  for (const auto& m : in.obj(v, "observe_until_ms").members()) st.observe_until_ms[m.key] = m.value.as_int();
  st.emergency = in.b(v, "emergency");
  st.emergency_lights = in.b(v, "emergency_lights");
  st.emergency_sensor = in.s(v, "emergency_sensor");
  st.next_ambient_ms = in.i(v, "next_ambient_ms");
  const Value& counters = in.obj(v, "counters");
  st.next_req = static_cast<std::uint64_t>(in.i(counters, "req"));
  st.next_plan = static_cast<std::uint64_t>(in.i(counters, "plan"));
  st.next_task = static_cast<std::uint64_t>(in.i(counters, "task"));
  st.next_seq = static_cast<std::uint64_t>(in.i(counters, "seq"));
  st.next_mem = static_cast<std::uint64_t>(in.i(counters, "mem"));
  if (!in.ok()) {
    error = in.error;
    return false;
  }
  out = std::move(st);
  return true;
}

void reset_event_digest(const Core& c) { c.rt.event_digest = EventDigest{}; }

std::string state_hash(const Core& c) {
  EventDigest& d = c.rt.event_digest;
  if (d.count > c.st.events.size()) d = EventDigest{};
  for (; d.count < c.st.events.size(); ++d.count) {
    d.value = fnv1a64(json::dump_canonical(event_json(c.st.events[d.count])), d.value);
    d.value = fnv1a64("\n", d.value);
  }
  Value v = state_to_json(c.st, false);
  v.set("events_count", static_cast<double>(d.count));
  v.set("events_digest", hex64(d.value));
  return "fnv1a64:" + hex64(fnv1a64(json::dump_canonical(v)));
}

Value snapshot_json(const Core& c, bool debug, double now_ms, bool with_hash) {
  const State& st = c.st;
  Value v = Value::object();
  v.set("sim_time_s", static_cast<double>(st.sim_ms) / 1000.0);
  v.set("revision", num(st.revision));
  v.set("hash", with_hash ? Value(state_hash(c)) : Value());
  Value res = Value::array();
  for (const auto& r : c.data.resources) {
    const ResourceState& rs = st.resources.at(r.id);
    Value e = Value::object();
    e.set("id", r.id);
    e.set("name_ru", r.name_ru);
    e.set("amount", rs.amount);
    e.set("reserved", rs.reserved);
    e.set("unit", r.unit);
    e.set("min_safe", r.min_safe);
    res.push(e);
  }
  v.set("resources", res);
  Value zones = Value::array();
  for (const auto& z : c.data.zones) {
    Value e = Value::object();
    e.set("id", z.id);
    e.set("name_ru", z.name_ru);
    e.set("sealed", st.sealed_zones.count(z.id) != 0);
    zones.push(e);
  }
  v.set("zones", zones);
  Value doors = Value::array();
  for (const auto& d : c.data.doors) {
    Value e = Value::object();
    e.set("id", d.id);
    e.set("a", d.a);
    e.set("b", d.b);
    e.set("state", st.doors.at(d.id).state);
    doors.push(e);
  }
  v.set("doors", doors);
  Value items = Value::array();
  for (const auto& it : c.data.items) {
    const ItemState& is = st.items.at(it.id);
    Value e = Value::object();
    e.set("id", it.id);
    e.set("name_ru", it.name_ru);
    e.set("zone", is.zone);
    e.set("locked_by", is.lock.empty() ? Value() : Value(is.lock));
    if (is.preserved) e.set("preserved", true);
    if (is.ready) e.set("ready", true);
    items.push(e);
  }
  v.set("items", items);
  Value sensors = Value::array();
  for (const auto& s : c.data.sensors) {
    const SensorState& ss = st.sensors.at(s.id);
    Value e = Value::object();
    e.set("id", s.id);
    e.set("name_ru", s.name_ru);
    e.set("zone", s.zone);
    e.set("unit", s.unit);
    e.set("reading", reading_to(ss.reading));
    e.set("fault", !ss.fault.empty());
    if (debug) {
      e.set("truth", reading_to(ss.truth));
      e.set("fault_id", ss.fault);
      e.set("distortion", ss.distortion);
    }
    sensors.push(e);
  }
  v.set("sensors", sensors);
  Value actors = Value::array();
  for (const auto& n : c.data.crew) {
    const ActorState& a = st.actors.at(n.id);
    Value e = Value::object();
    e.set("id", n.id);
    e.set("name_ru", n.name_ru);
    e.set("is_player", n.is_player);
    e.set("zone", a.zone);
    const std::string tz = target_zone_of(c, a);
    if (!tz.empty() && tz != a.zone) e.set("target_zone", tz);
    if (!a.task_id.empty()) e.set("task_id", a.task_id);
    if (!a.plan_id.empty()) e.set("plan_id", a.plan_id);
    e.set("activity", a.activity);
    e.set("fatigue", a.fatigue);
    e.set("trust_player", a.trust_player);
    e.set("gesture", a.gesture);
    e.set("style", a.style);
    e.set("busy", actor_busy(c, n.id));
    actors.push(e);
  }
  v.set("actors", actors);
  Value tasks = Value::array();
  std::vector<const Task*> shown;
  for (const auto& [id, t] : st.tasks) {
    if (t.state == "active") shown.push_back(&t);
  }
  std::vector<const Task*> finished;
  for (const auto& [id, t] : st.tasks) {
    if (t.state != "active") finished.push_back(&t);
  }
  std::sort(finished.begin(), finished.end(), [](const Task* a, const Task* b) { return a->finished_ms > b->finished_ms; });
  for (std::size_t i = 0; i < finished.size() && i < 12; ++i) shown.push_back(finished[i]);
  for (const Task* t : shown) {
    Value e = Value::object();
    e.set("id", t->id);
    e.set("action", t->action);
    e.set("actor", t->actor);
    if (!t->companion.empty()) e.set("companion", t->companion);
    if (!t->target.empty()) e.set("target", t->target);
    e.set("proposer", t->proposer);
    e.set("state", t->state);
    e.set("phase", t->phase);
    e.set("progress", t->progress());
    e.set("source", t->source);
    tasks.push(e);
  }
  v.set("tasks", tasks);
  Value plans = Value::array();
  for (const auto& [id, p] : st.plans) {
    Value e = Value::object();
    e.set("plan_id", id);
    e.set("actor", p.actor);
    e.set("task_id", p.request_id);
    Value prop = Value::object();
    prop.set("action", p.proposal.action);
    prop.set("target_id", p.proposal.target.empty() ? Value() : Value(p.proposal.target));
    prop.set("companion_id", p.proposal.companion.empty() ? Value() : Value(p.proposal.companion));
    prop.set("fact_ids", strs(p.proposal.fact_ids));
    prop.set("style", p.proposal.style);
    prop.set("gesture", p.proposal.gesture);
    e.set("proposal", prop);
    e.set("state", p.state);
    e.set("expires_s", static_cast<double>(p.expires_ms) / 1000.0);
    if (!p.world_task_id.empty()) e.set("world_task_id", p.world_task_id);
    plans.push(e);
  }
  v.set("plans", plans);
  Value queue = Value::array();
  for (const auto& q : st.queue) {
    Value e = Value::object();
    e.set("task_id", q.task_id);
    e.set("actor", q.actor);
    e.set("kind", q.kind);
    e.set("priority", q.priority);
    e.set("state", "queued");
    e.set("deadline_ms", q.deadline_ms);
    queue.push(e);
  }
  for (const auto& [id, r] : st.requests) {
    if (r.state != "pending") continue;
    Value e = Value::object();
    e.set("task_id", id);
    e.set("actor", r.actor);
    e.set("kind", r.kind);
    e.set("priority", c.data.profiles.admission.priority.at(r.kind == "order_response" ? "direct_reply" : r.kind));
    e.set("state", "active");
    e.set("deadline_ms", r.deadline_ms);
    e.set("backend", r.backend);
    queue.push(e);
  }
  v.set("queue", queue);
  v.set("director", director_json(c));
  v.set("biography", biography_json(c));
  v.set("emergency_lights", st.emergency_lights);
  v.set("emergency", st.emergency);
  v.set("gate", gate_json(evaluate_gate(c, now_ms)));
  Value cfg = Value::object();
  cfg.set("mode", c.rt.config.mode);
  cfg.set("effective_mode", effective_mode(c));
  cfg.set("gpu_enabled", c.rt.config.gpu_enabled);
  cfg.set("calibrated", c.rt.config.calibrated);
  cfg.set("privacy_profile", c.rt.config.privacy_profile);
  v.set("ai_config", cfg);
  v.set("last_event_seq", st.events.empty() ? 0.0 : static_cast<double>(st.events.back().seq));
  if (debug) {
    Value er = Value::object();
    for (const auto& [k, r] : st.entity_rev) er.set(k, num(r));
    v.set("entity_rev", er);
    Value pending = Value::array();
    for (const auto& [id, r] : st.requests) {
      Value e = Value::object();
      e.set("task_id", id);
      e.set("actor", r.actor);
      e.set("state", r.state);
      e.set("backend", r.backend);
      e.set("world_revision", num(r.world_revision));
      pending.push(e);
    }
    v.set("requests", pending);
  }
  return v;
}

Value make_save(const Core& c) {
  Value s = Value::object();
  s.set("format", kSaveFormat);
  s.set("core_version", kCoreVersion);
  s.set("data_hash", c.data.data_hash);
  Value versions = Value::object();
  versions.set("prompt_version", kPromptVersion);
  versions.set("intent_schema_version", kIntentSchemaVersion);
  versions.set("rules_model", "utility-policy");
  std::vector<std::string> models(c.rt.ai.models_seen.begin(), c.rt.ai.models_seen.end());
  versions.set("models_seen", strs(models));
  s.set("versions", versions);
  s.set("seed", num_u(c.st.seed));
  s.set("kv_cache_included", false);
  Value cfg = Value::object();
  cfg.set("mode", c.rt.config.mode);
  cfg.set("gpu_enabled", c.rt.config.gpu_enabled);
  cfg.set("calibrated", c.rt.config.calibrated);
  cfg.set("privacy_profile", c.rt.config.privacy_profile);
  cfg.set("cpu_cores", c.rt.config.cpu_cores);
  s.set("ai_config", cfg);
  s.set("hash", state_hash(c));
  s.set("state", state_to_json(c.st));
  return s;
}

bool load_save(Core& c, const Value& save, std::string& error_code, std::string& error_message) {
  if (!save.is_object() || save["format"].str() != kSaveFormat) {
    error_code = "bad_save";
    error_message = std::string("ожидалось сохранение формата ") + kSaveFormat;
    return false;
  }
  if (save["data_hash"].str() != c.data.data_hash) {
    error_code = "data_mismatch";
    error_message = "сохранение сделано на других данных мира (data_hash " + save["data_hash"].str() + " ≠ " + c.data.data_hash + ")";
    return false;
  }
  State st;
  std::string err;
  if (!state_from_json(save["state"], st, err)) {
    error_code = "bad_save";
    error_message = "повреждённое сохранение: " + err;
    return false;
  }
  for (const auto& n : c.data.crew) {
    if (st.actors.count(n.id) == 0) {
      error_code = "bad_save";
      error_message = "в сохранении нет персонажа " + n.id;
      return false;
    }
  }
  State previous = std::move(c.st);
  c.st = std::move(st);
  reset_event_digest(c);
  if (save.has("hash") && save["hash"].str() != state_hash(c)) {
    c.st = std::move(previous);
    reset_event_digest(c);
    error_code = "hash_mismatch";
    error_message = "хеш состояния не совпадает: сохранение изменено или повреждено";
    return false;
  }
  const Value& cfg = save["ai_config"];
  if (cfg.is_object()) {
    c.rt.config.mode = cfg["mode"].str("smooth");
    c.rt.config.gpu_enabled = cfg["gpu_enabled"].as_bool();
    c.rt.config.calibrated = cfg["calibrated"].as_bool();
    c.rt.config.privacy_profile = cfg["privacy_profile"].str("offline");
    c.rt.config.cpu_cores = static_cast<int>(cfg["cpu_cores"].as_int());
  }
  return true;
}

}  // namespace echo
