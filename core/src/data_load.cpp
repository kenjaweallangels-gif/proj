#include <algorithm>
#include <set>

#include "echo/data.hpp"
#include "echo/util.hpp"

namespace echo {
namespace {

using json::Value;

const std::vector<std::string> kCases = {"nom", "gen", "dat", "acc", "ins", "prep"};
const std::vector<std::string> kDirectorEffectTypes = {"sound", "instrument_distortion", "interpretation"};
const std::vector<std::string> kJournalKinds = {"inspect", "repair", "isolation", "rest", "work_together",
                                                "tool_used", "survey", "sample", "rover"};
const std::vector<std::string> kSpeechKinds = {"immediate", "line", "fallback", "evidence"};

// Collects the first validation error with a JSON-path-like location.
class Reader {
 public:
  explicit Reader(std::string& err) : err_(err) {}

  bool ok() const { return err_.empty(); }

  bool fail(const std::string& path, const std::string& what) {
    if (err_.empty()) err_ = path + ": " + what;
    return false;
  }

  const Value* field(const Value& o, std::string_view key, const std::string& path, bool required) {
    if (!o.is_object()) {
      fail(path, "ожидался объект");
      return nullptr;
    }
    const Value* v = o.find(key);
    if (v == nullptr && required) fail(path + "." + std::string(key), "обязательное поле отсутствует");
    return v;
  }

  std::string str(const Value& o, std::string_view key, const std::string& path, bool required = true,
                  std::string fallback = "") {
    const Value* v = field(o, key, path, required);
    if (v == nullptr || (v->is_null() && !required)) return fallback;
    if (!v->is_string()) {
      fail(path + "." + std::string(key), "ожидалась строка");
      return fallback;
    }
    return v->as_string();
  }

  double num(const Value& o, std::string_view key, const std::string& path, bool required = true,
             double fallback = 0.0) {
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return fallback;
    if (!v->is_number()) {
      fail(path + "." + std::string(key), "ожидалось число");
      return fallback;
    }
    return v->as_number();
  }

  bool boolean(const Value& o, std::string_view key, const std::string& path, bool required = true,
               bool fallback = false) {
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return fallback;
    if (!v->is_bool()) {
      fail(path + "." + std::string(key), "ожидалось true/false");
      return fallback;
    }
    return v->as_bool();
  }

  const std::vector<Value>& arr(const Value& o, std::string_view key, const std::string& path, bool required = true) {
    static const std::vector<Value> kEmpty;
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return kEmpty;
    if (!v->is_array()) {
      fail(path + "." + std::string(key), "ожидался массив");
      return kEmpty;
    }
    return v->items();
  }

  const Value& obj(const Value& o, std::string_view key, const std::string& path, bool required = true) {
    static const Value kEmpty = Value::object();
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return kEmpty;
    if (!v->is_object()) {
      fail(path + "." + std::string(key), "ожидался объект");
      return kEmpty;
    }
    return *v;
  }

  std::vector<std::string> strs(const Value& o, std::string_view key, const std::string& path, bool required = true) {
    std::vector<std::string> out;
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return out;
    if (!v->is_array()) {
      fail(path + "." + std::string(key), "ожидался массив строк");
      return out;
    }
    for (std::size_t i = 0; i < v->size(); ++i) {
      const Value& item = v->at(i);
      if (!item.is_string()) {
        fail(path + "." + std::string(key) + "[" + std::to_string(i) + "]", "ожидалась строка");
        return out;
      }
      out.push_back(item.as_string());
    }
    return out;
  }

  std::vector<std::pair<std::string, double>> num_map(const Value& o, std::string_view key, const std::string& path,
                                                      bool required = true) {
    std::vector<std::pair<std::string, double>> out;
    const Value* v = field(o, key, path, required);
    if (v == nullptr) return out;
    if (!v->is_object()) {
      fail(path + "." + std::string(key), "ожидался объект чисел");
      return out;
    }
    for (const auto& m : v->members()) {
      if (!m.value.is_number()) {
        fail(path + "." + std::string(key) + "." + m.key, "ожидалось число");
        return out;
      }
      out.emplace_back(m.key, m.value.as_number());
    }
    return out;
  }

  Reading reading(const Value& o, std::string_view key, const std::string& path) {
    Reading r;
    const Value& v = obj(o, key, path);
    r.value = num(v, "value", path + "." + std::string(key));
    r.trend = str(v, "trend", path + "." + std::string(key));
    return r;
  }

  void check_format(const Value& o, const std::string& path, std::string_view expected) {
    const std::string f = str(o, "format", path);
    if (ok() && f != expected) fail(path + ".format", "ожидался формат " + std::string(expected) + ", получен " + f);
  }

 private:
  std::string& err_;
};

std::string idx(const std::string& path, std::size_t i) { return path + "[" + std::to_string(i) + "]"; }

template <typename T>
bool unique_ids(Reader& r, const std::vector<T>& items, const std::string& path) {
  std::set<std::string> seen;
  for (const auto& it : items) {
    if (it.id.empty()) return r.fail(path, "пустой id");
    if (!seen.insert(it.id).second) return r.fail(path, "повторяющийся id " + it.id);
  }
  return true;
}

// Tokenizes an alias/keyword pattern: words separated by spaces, alternatives by '|', folded to lowercase.
std::vector<std::vector<std::string>> parse_pattern(const std::string& pattern) {
  std::vector<std::vector<std::string>> tokens;
  std::string folded = fold_ru(pattern);
  std::size_t start = 0;
  while (start <= folded.size()) {
    std::size_t end = folded.find(' ', start);
    if (end == std::string::npos) end = folded.size();
    const std::string word = folded.substr(start, end - start);
    if (!word.empty()) {
      std::vector<std::string> alts;
      std::size_t a = 0;
      while (a <= word.size()) {
        std::size_t b = word.find('|', a);
        if (b == std::string::npos) b = word.size();
        if (b > a) alts.push_back(word.substr(a, b - a));
        a = b + 1;
      }
      tokens.push_back(alts);
    }
    start = end + 1;
  }
  return tokens;
}

void load_world(Reader& r, const Value& w, StaticData& d) {
  const std::string p = "world";
  r.check_format(w, p, "zero-echo.world.v1");
  d.world_id = r.str(w, "id", p);
  d.title_ru = r.str(w, "title_ru", p, false);
  d.player_id = r.str(w, "player_id", p);
  d.world_seed = static_cast<std::uint64_t>(r.num(w, "seed", p, false, 1.0));

  const auto& zones = r.arr(w, "zones", p);
  for (std::size_t i = 0; i < zones.size() && r.ok(); ++i) {
    const std::string zp = idx(p + ".zones", i);
    ZoneDef z;
    z.id = r.str(zones[i], "id", zp);
    z.name_ru = r.str(zones[i], "name_ru", zp);
    z.kind = r.str(zones[i], "kind", zp);
    z.pressurized = r.boolean(zones[i], "pressurized", zp);
    z.suit_required = r.boolean(zones[i], "suit_required", zp);
    z.anchors = r.strs(zones[i], "anchors", zp, false);
    d.zones.push_back(z);
  }
  unique_ids(r, d.zones, p + ".zones");

  const auto& doors = r.arr(w, "doors", p);
  for (std::size_t i = 0; i < doors.size() && r.ok(); ++i) {
    const std::string dp = idx(p + ".doors", i);
    DoorDef dd;
    dd.id = r.str(doors[i], "id", dp);
    dd.a = r.str(doors[i], "a", dp);
    dd.b = r.str(doors[i], "b", dp);
    dd.state = r.str(doors[i], "state", dp);
    dd.cycle_s = r.num(doors[i], "cycle_s", dp, false, 0.0);
    if (!r.ok()) break;
    if (d.zone(dd.a) == nullptr || d.zone(dd.b) == nullptr) r.fail(dp, "дверь ссылается на неизвестную зону");
    if (dd.state != "open" && dd.state != "closed" && dd.state != "sealed") r.fail(dp + ".state", "ожидалось open|closed|sealed");
    if (dd.cycle_s < 0) r.fail(dp + ".cycle_s", "отрицательное время цикла");
    d.doors.push_back(dd);
  }
  unique_ids(r, d.doors, p + ".doors");

  const auto& res = r.arr(w, "resources", p);
  for (std::size_t i = 0; i < res.size() && r.ok(); ++i) {
    const std::string rp = idx(p + ".resources", i);
    ResourceDef rd;
    rd.id = r.str(res[i], "id", rp);
    rd.name_ru = r.str(res[i], "name_ru", rp);
    rd.unit = r.str(res[i], "unit", rp);
    rd.amount = r.num(res[i], "amount", rp);
    rd.min_safe = r.num(res[i], "min_safe", rp, false, 0.0);
    if (rd.amount < 0) r.fail(rp + ".amount", "отрицательный запас");
    d.resources.push_back(rd);
  }
  unique_ids(r, d.resources, p + ".resources");

  const auto& items = r.arr(w, "items", p);
  for (std::size_t i = 0; i < items.size() && r.ok(); ++i) {
    const std::string ip = idx(p + ".items", i);
    ItemDef it;
    it.id = r.str(items[i], "id", ip);
    it.name_ru = r.str(items[i], "name_ru", ip);
    it.zone = r.str(items[i], "zone", ip);
    it.kind = r.str(items[i], "kind", ip);
    if (r.ok() && d.zone(it.zone) == nullptr) r.fail(ip + ".zone", "неизвестная зона " + it.zone);
    d.items.push_back(it);
  }
  unique_ids(r, d.items, p + ".items");

  const auto& sensors = r.arr(w, "sensors", p);
  for (std::size_t i = 0; i < sensors.size() && r.ok(); ++i) {
    const std::string sp = idx(p + ".sensors", i);
    SensorDef s;
    s.id = r.str(sensors[i], "id", sp);
    s.name_ru = r.str(sensors[i], "name_ru", sp);
    s.zone = r.str(sensors[i], "zone", sp);
    s.kind = r.str(sensors[i], "kind", sp);
    s.unit = r.str(sensors[i], "unit", sp);
    s.truth = r.reading(sensors[i], "truth", sp);
    s.reading = r.reading(sensors[i], "reading", sp);
    s.fault = r.str(sensors[i], "fault", sp, false);
    if (r.ok() && d.zone(s.zone) == nullptr) r.fail(sp + ".zone", "неизвестная зона " + s.zone);
    d.sensors.push_back(s);
  }
  unique_ids(r, d.sensors, p + ".sensors");

  const auto& facts = r.arr(w, "facts", p);
  for (std::size_t i = 0; i < facts.size() && r.ok(); ++i) {
    const std::string fp = idx(p + ".facts", i);
    FactDef f;
    f.id = r.str(facts[i], "id", fp);
    f.layer = r.str(facts[i], "layer", fp);
    f.is_protected = r.boolean(facts[i], "protected", fp);
    f.text_ru = r.str(facts[i], "text_ru", fp);
    f.about = r.strs(facts[i], "about", fp, false);
    d.facts.push_back(f);
  }
  unique_ids(r, d.facts, p + ".facts");

  const Value& know = r.obj(w, "initial_knowledge", p, false);
  for (const auto& m : know.members()) {
    if (!m.value.is_array()) {
      r.fail(p + ".initial_knowledge." + m.key, "ожидался массив");
      break;
    }
    for (std::size_t i = 0; i < m.value.size() && r.ok(); ++i) {
      const std::string kp = idx(p + ".initial_knowledge." + m.key, i);
      KnowledgeSeed k;
      k.fact = r.str(m.value.at(i), "fact", kp);
      k.source = r.str(m.value.at(i), "source", kp);
      if (r.ok() && d.fact(k.fact) == nullptr) r.fail(kp + ".fact", "неизвестный факт " + k.fact);
      d.initial_knowledge[m.key].push_back(k);
    }
  }

  const auto& hist = r.arr(w, "history_events", p, false);
  for (std::size_t i = 0; i < hist.size() && r.ok(); ++i) {
    const std::string hp = idx(p + ".history_events", i);
    HistoryEventDef h;
    h.id = r.str(hist[i], "id", hp);
    h.time_s = r.num(hist[i], "time_s", hp);
    h.type = r.str(hist[i], "type", hp);
    h.summary_ru = r.str(hist[i], "summary_ru", hp);
    h.actors = r.strs(hist[i], "actors", hp, false);
    d.history.push_back(h);
  }

  const Value& ops = r.obj(w, "initial_opinions", p, false);
  for (const auto& m : ops.members()) {
    for (std::size_t i = 0; i < m.value.size() && r.ok(); ++i) {
      const std::string op = idx(p + ".initial_opinions." + m.key, i);
      OpinionSeed o;
      o.about = r.str(m.value.at(i), "about", op);
      o.text_ru = r.str(m.value.at(i), "text_ru", op);
      o.confidence = r.num(m.value.at(i), "confidence", op, false, 0.5);
      o.source = r.str(m.value.at(i), "source", op);
      d.initial_opinions[m.key].push_back(o);
    }
  }

  const auto& trig = r.arr(w, "scripted_triggers", p, false);
  for (std::size_t i = 0; i < trig.size() && r.ok(); ++i) {
    const std::string tp = idx(p + ".scripted_triggers", i);
    ScriptedTrigger t;
    t.id = r.str(trig[i], "id", tp);
    t.at_time_s = r.num(trig[i], "at_time_s", tp);
    t.type = r.str(trig[i], "type", tp);
    t.sensor = r.str(trig[i], "sensor", tp);
    t.reading = r.reading(trig[i], "reading", tp);
    if (r.ok() && t.type != "sensor_fault") r.fail(tp + ".type", "поддерживается только sensor_fault");
    if (r.ok() && d.sensor(t.sensor) == nullptr) r.fail(tp + ".sensor", "неизвестный датчик");
    const auto& rev = r.arr(trig[i], "reveal", tp, false);
    for (std::size_t k = 0; k < rev.size() && r.ok(); ++k) {
      const std::string rp = idx(tp + ".reveal", k);
      TriggerReveal tr;
      tr.fact = r.str(rev[k], "fact", rp);
      tr.to = r.strs(rev[k], "to", rp);
      tr.source = r.str(rev[k], "source", rp);
      if (r.ok() && d.fact(tr.fact) == nullptr) r.fail(rp + ".fact", "неизвестный факт");
      t.reveal.push_back(tr);
    }
    if (const Value* ini = trig[i].find("initiative"); ini != nullptr && ini->is_object()) {
      t.has_initiative = true;
      t.initiative_actor = r.str(*ini, "actor", tp + ".initiative");
      t.initiative_kind = r.str(*ini, "kind", tp + ".initiative");
      t.initiative_situation_ru = r.str(*ini, "situation_ru", tp + ".initiative");
    }
    d.triggers.push_back(t);
  }

  const auto& insp = r.arr(w, "inspection_reveals", p, false);
  for (std::size_t i = 0; i < insp.size() && r.ok(); ++i) {
    const std::string ip = idx(p + ".inspection_reveals", i);
    InspectionReveal ir;
    ir.target = r.str(insp[i], "target", ip);
    ir.reveal = r.strs(insp[i], "reveal", ip);
    ir.condition = r.str(insp[i], "condition", ip);
    if (r.ok() && ir.condition != "always" && ir.condition != "sensor_fault_active") {
      r.fail(ip + ".condition", "ожидалось always|sensor_fault_active");
    }
    for (const auto& f : ir.reveal) {
      if (r.ok() && d.fact(f) == nullptr) r.fail(ip + ".reveal", "неизвестный факт " + f);
    }
    d.inspection_reveals.push_back(ir);
  }
}

void load_persona(Reader& r, const Value& n, NpcDef& npc, const std::string& p) {
  npc.name_ru = r.str(n, "name_ru", p);
  npc.zone = r.str(n, "zone", p);
  if (npc.is_player) return;
  npc.role_ru = r.str(n, "role_ru", p);
  npc.role = r.str(n, "role", p);
  const Value& persona = r.obj(n, "persona", p);
  npc.values_ru = r.str(persona, "values_ru", p + ".persona");
  npc.style_ru = r.str(persona, "style_ru", p + ".persona");
  npc.boundaries_ru = r.str(persona, "boundaries_ru", p + ".persona");
  npc.quirks_ru = r.str(persona, "speech_quirks_ru", p + ".persona", false);
  npc.skills = r.num_map(n, "skills", p);
  npc.fatigue = r.num(n, "fatigue", p);
  npc.health = r.num(n, "health", p, false, 1.0);
  npc.trust_player = r.num(n, "trust_player", p, false, 0.5);
  npc.relationships = r.num_map(n, "relationships", p, false);
  const auto w = r.num_map(n, "policy_weights", p);
  for (const auto& [k, v] : w) {
    if (k == "safety") npc.weights.safety = v;
    else if (k == "curiosity") npc.weights.curiosity = v;
    else if (k == "efficiency") npc.weights.efficiency = v;
    else if (k == "social") npc.weights.social = v;
    else if (k == "self_care") npc.weights.self_care = v;
  }
  if (const Value* c = n.find("color"); c != nullptr && c->is_array() && c->size() == 3) {
    for (std::size_t i = 0; i < 3; ++i) npc.color[i] = c->at(i).as_number(0.7);
  }
}

void load_npcs(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "npcs";
  r.check_format(v, p, "zero-echo.npcs.v1");
  NpcDef player;
  player.is_player = true;
  const Value& pl = r.obj(v, "player", p);
  player.id = r.str(pl, "id", p + ".player");
  load_persona(r, pl, player, p + ".player");
  player.role = "commander";
  player.role_ru = "командир";
  d.crew.push_back(player);
  const auto& npcs = r.arr(v, "npcs", p);
  for (std::size_t i = 0; i < npcs.size() && r.ok(); ++i) {
    NpcDef n;
    n.id = r.str(npcs[i], "id", idx(p + ".npcs", i));
    load_persona(r, npcs[i], n, idx(p + ".npcs", i));
    if (r.ok() && d.zone(n.zone) == nullptr) r.fail(idx(p + ".npcs", i) + ".zone", "неизвестная зона");
    d.crew.push_back(n);
  }
  unique_ids(r, d.crew, p);
  if (r.ok() && player.id != d.player_id) r.fail(p + ".player.id", "не совпадает с world.player_id");
}

void load_actions(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "actions";
  r.check_format(v, p, "zero-echo.actions.v1");
  d.styles = r.strs(v, "styles", p);
  d.gestures = r.strs(v, "gestures", p);
  const Value& phys = r.obj(v, "physical_rules", p);
  d.physical.eva_max_fatigue = r.num(phys, "eva_max_fatigue", p + ".physical_rules");
  d.physical.eva_min_skill = r.num(phys, "eva_min_skill", p + ".physical_rules");
  d.physical.busy_actor_can_be_companion = r.boolean(phys, "busy_actor_can_be_companion", p + ".physical_rules", false);
  const auto& acts = r.arr(v, "actions", p);
  for (std::size_t i = 0; i < acts.size() && r.ok(); ++i) {
    const std::string ap = idx(p + ".actions", i);
    const Value& a = acts[i];
    ActionDef ad;
    ad.id = r.str(a, "id", ap);
    ad.label_ru = r.str(a, "label_ru", ap);
    ad.description_ru = r.str(a, "description_ru", ap, false);
    const Value& t = r.obj(a, "target", ap);
    ad.target_kinds = r.strs(t, "kinds", ap + ".target");
    ad.target_required = r.boolean(t, "required", ap + ".target");
    ad.zone_kinds = r.strs(t, "zone_kinds", ap + ".target", false);
    ad.item_kinds = r.strs(t, "item_kinds", ap + ".target", false);
    ad.self_allowed = r.boolean(t, "self_allowed", ap + ".target", false);
    ad.others_roles = r.strs(t, "others_roles", ap + ".target", false);
    ad.companion = r.str(a, "companion", ap);
    if (r.ok() && ad.companion != "none" && ad.companion != "optional") r.fail(ap + ".companion", "ожидалось none|optional");
    const Value& f = r.obj(a, "fact_ids", ap);
    ad.fact_min = static_cast<int>(r.num(f, "min", ap + ".fact_ids"));
    ad.fact_max = static_cast<int>(r.num(f, "max", ap + ".fact_ids"));
    if (r.ok() && (ad.fact_min < 0 || ad.fact_max < ad.fact_min || ad.fact_max > 4)) r.fail(ap + ".fact_ids", "неверные лимиты");
    ad.roles = r.strs(a, "roles", ap);
    ad.min_skill = r.num_map(a, "min_skill", ap, false);
    ad.tools = r.strs(a, "tools", ap, false);
    ad.consumes = r.num_map(a, "consumes", ap, false);
    ad.duration_s = r.num(a, "duration_s", ap);
    ad.cooldown_s = r.num(a, "cooldown_s", ap);
    ad.approval = r.str(a, "approval", ap);
    if (r.ok() && ad.approval != "never" && ad.approval != "always" && ad.approval != "if_companion" &&
        ad.approval != "if_target_other") {
      r.fail(ap + ".approval", "неизвестный режим одобрения");
    }
    ad.effects = r.strs(a, "effects", ap, false);
    ad.gesture_default = r.str(a, "gesture_default", ap, false, "none");
    for (const auto& tool : ad.tools) {
      if (r.ok() && d.item(tool) == nullptr) r.fail(ap + ".tools", "неизвестный инструмент " + tool);
    }
    for (const auto& [res, amount] : ad.consumes) {
      if (r.ok() && d.resource(res) == nullptr) r.fail(ap + ".consumes", "неизвестный ресурс " + res);
      if (r.ok() && amount < 0) r.fail(ap + ".consumes", "отрицательный расход");
    }
    d.actions.push_back(ad);
  }
  unique_ids(r, d.actions, p + ".actions");
}

void load_profiles(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "profiles";
  r.check_format(v, p, "zero-echo.profiles.v1");
  d.profiles.frame_budget_ms = r.num(v, "frame_budget_ms", p);
  d.profiles.pause_threshold_ms = r.num(v, "pause_threshold_ms", p);
  const Value& a = r.obj(v, "admission", p);
  const std::string ap = p + ".admission";
  AdmissionConfig& ac = d.profiles.admission;
  ac.max_active_generations = static_cast<int>(r.num(a, "max_active_generations", ap));
  ac.max_queue_length = static_cast<int>(r.num(a, "max_queue_length", ap));
  for (const auto& [k, val] : r.num_map(a, "deadline_ms", ap)) ac.deadline_ms[k] = val;
  for (const auto& [k, val] : r.num_map(a, "priority", ap)) ac.priority[k] = static_cast<int>(val);
  const Value& g = r.obj(a, "gpu_gate", ap);
  ac.gate.p95_gpu_ms_max = r.num(g, "p95_gpu_ms_max", ap + ".gpu_gate");
  ac.gate.p99_frame_ms_max = r.num(g, "p99_frame_ms_max", ap + ".gpu_gate");
  ac.gate.vram_reserve_gib_min = r.num(g, "vram_reserve_gib_min", ap + ".gpu_gate");
  ac.gate.stable_window_s = r.num(g, "stable_window_s", ap + ".gpu_gate");
  ac.gate.cooldown_s = r.num(g, "cooldown_s", ap + ".gpu_gate");
  ac.gate.stats_max_age_s = r.num(g, "stats_max_age_s", ap + ".gpu_gate");
  const Value& ct = r.obj(a, "cpu_threads", ap);
  ac.cpu_threads_min = static_cast<int>(r.num(ct, "min", ap + ".cpu_threads"));
  ac.cpu_threads_max = static_cast<int>(r.num(ct, "max", ap + ".cpu_threads"));
  const Value& tb = r.obj(a, "token_budget", ap);
  ac.max_input_tokens = static_cast<int>(r.num(tb, "max_input_tokens", ap + ".token_budget"));
  ac.max_output_tokens = static_cast<int>(r.num(tb, "max_output_tokens", ap + ".token_budget"));
  const Value& layers = r.obj(a, "memory_layers_tokens", ap);
  for (const auto& m : layers.members()) {
    if (!m.value.is_array() || m.value.size() != 2 || !m.value.at(0).is_number() || !m.value.at(1).is_number()) {
      r.fail(ap + ".memory_layers_tokens." + m.key, "ожидалось [min, max]");
      break;
    }
    ac.layer_tokens[m.key] = {static_cast<int>(m.value.at(0).as_number()), static_cast<int>(m.value.at(1).as_number())};
  }
  for (const char* layer : {"role", "knowledge", "situation", "recent", "relations", "format"}) {
    if (r.ok() && ac.layer_tokens.count(layer) == 0) r.fail(ap + ".memory_layers_tokens", std::string("нет слоя ") + layer);
  }
  for (const char* k : {"emergency", "direct_reply", "initiative", "ambient"}) {
    if (r.ok() && ac.priority.count(k) == 0) r.fail(ap + ".priority", std::string("нет приоритета ") + k);
  }
  for (const char* k : {"direct_reply", "initiative", "ambient"}) {
    if (r.ok() && ac.deadline_ms.count(k) == 0) r.fail(ap + ".deadline_ms", std::string("нет срока ") + k);
  }
  if (r.ok() && (ac.max_active_generations < 1 || ac.max_queue_length < 1)) r.fail(ap, "лимиты очереди должны быть ≥ 1");
}

bool parse_slots(Reader& r, SpeechTemplate& t, const std::string& path) {
  std::size_t pos = 0;
  while ((pos = t.text.find('{', pos)) != std::string::npos) {
    const std::size_t end = t.text.find('}', pos);
    if (end == std::string::npos) return r.fail(path + ".text", "незакрытая подстановка");
    const std::string slot = t.text.substr(pos + 1, end - pos - 1);
    const std::size_t dot = slot.find('.');
    const std::string base = slot.substr(0, dot);
    const std::string form = dot == std::string::npos ? "nom" : slot.substr(dot + 1);
    if (base == "target") t.needs_target = true;
    else if (base == "companion") t.needs_companion = true;
    else if (base == "fact" || base == "facts") {
      t.needs_fact = true;
      if (dot != std::string::npos) return r.fail(path + ".text", "у {fact} нет падежей");
    } else if (base != "player" && base != "actor") {
      return r.fail(path + ".text", "неизвестная подстановка {" + slot + "}");
    }
    if (!contains(kCases, form)) return r.fail(path + ".text", "неизвестный падеж в {" + slot + "}");
    pos = end + 1;
  }
  return true;
}

void load_speech(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "speech";
  r.check_format(v, p, "zero-echo.speech.v1");
  SpeechData& sd = d.speech;
  sd.anti_repeat_window = static_cast<int>(r.num(v, "anti_repeat_window", p, false, 4));
  const Value& names = r.obj(v, "names", p);
  for (const auto& m : names.members()) {
    const std::string np = p + ".names." + m.key;
    NameForms nf;
    nf.nom = r.str(m.value, "nom", np);
    nf.gen = r.str(m.value, "gen", np);
    nf.dat = r.str(m.value, "dat", np);
    nf.acc = r.str(m.value, "acc", np);
    nf.ins = r.str(m.value, "ins", np);
    nf.prep = r.str(m.value, "prep", np);
    sd.names[m.key] = nf;
  }
  const auto& aliases = r.arr(v, "target_aliases", p, false);
  for (std::size_t i = 0; i < aliases.size() && r.ok(); ++i) {
    const std::string ap = idx(p + ".target_aliases", i);
    const std::string target = r.str(aliases[i], "target", ap);
    for (const auto& pat : r.strs(aliases[i], "patterns", ap)) sd.aliases.push_back({target, parse_pattern(pat)});
    if (r.ok() && target != "*sensor" && d.kind_of(target).empty()) r.fail(ap + ".target", "неизвестная цель " + target);
  }
  const auto& intents = r.arr(v, "say_intents", p, false);
  for (std::size_t i = 0; i < intents.size() && r.ok(); ++i) {
    const std::string ip = idx(p + ".say_intents", i);
    SayIntentPattern si;
    si.intent = r.str(intents[i], "intent", ip);
    for (const auto& pat : r.strs(intents[i], "patterns", ip)) si.patterns.push_back(parse_pattern(pat));
    sd.say_intents.push_back(si);
  }
  const auto& templates = r.arr(v, "templates", p);
  std::set<std::string> ids;
  for (std::size_t i = 0; i < templates.size() && r.ok(); ++i) {
    const std::string tp = idx(p + ".templates", i);
    const Value& tv = templates[i];
    SpeechTemplate t;
    t.id = r.str(tv, "id", tp);
    t.kind = r.str(tv, "kind", tp);
    t.stage = r.str(tv, "stage", tp);
    t.action = r.str(tv, "action", tp, false);
    t.text = r.str(tv, "text", tp);
    t.gesture = r.str(tv, "gesture", tp, false);
    t.actors = r.strs(tv, "actors", tp, false);
    t.styles = r.strs(tv, "styles", tp, false);
    if (const Value* w = tv.find("when"); w != nullptr) {
      const std::string wp = tp + ".when";
      t.when_known_fact = r.str(*w, "known_fact", wp, false);
      t.when_situation = r.str(*w, "situation", wp, false);
      t.when_target_kind = r.str(*w, "target_kind", wp, false);
      t.when_target = r.str(*w, "target", wp, false);
      t.when_result_fact = r.str(*w, "result_fact", wp, false);
      t.when_reason = r.str(*w, "reason", wp, false);
      t.when_say_intent = r.str(*w, "say_intent", wp, false);
      if (w->has("companion")) t.when_companion = r.boolean(*w, "companion", wp) ? 1 : 0;
      if (w->has("target_self")) t.when_target_self = r.boolean(*w, "target_self", wp) ? 1 : 0;
      for (const auto& m : w->members()) {
        static const std::vector<std::string> kKeys = {"known_fact", "situation", "target_kind", "target", "result_fact",
                                                       "reason", "say_intent", "companion", "target_self"};
        if (r.ok() && !contains(kKeys, m.key)) r.fail(wp + "." + m.key, "неизвестное условие");
      }
      for (const std::string* f : {&t.when_known_fact, &t.when_result_fact}) {
        if (r.ok() && !f->empty() && d.fact(*f) == nullptr) r.fail(wp, "неизвестный факт " + *f);
      }
    }
    if (!r.ok()) break;
    if (!ids.insert(t.id).second) r.fail(tp + ".id", "повторяющийся id " + t.id);
    if (!contains(kSpeechKinds, t.kind)) r.fail(tp + ".kind", "неизвестный вид реплики " + t.kind);
    if (!t.action.empty() && d.action(t.action) == nullptr) r.fail(tp + ".action", "неизвестное действие " + t.action);
    for (const auto& a : t.actors) {
      if (r.ok() && d.npc(a) == nullptr) r.fail(tp + ".actors", "неизвестный персонаж " + a);
    }
    for (const auto& s : t.styles) {
      if (r.ok() && !contains(d.styles, s)) r.fail(tp + ".styles", "неизвестный стиль " + s);
    }
    if (r.ok() && !t.gesture.empty() && !contains(d.gestures, t.gesture)) r.fail(tp + ".gesture", "неизвестный жест");
    if (r.ok() && !json::valid_utf8(t.text)) r.fail(tp + ".text", "неверный UTF-8");
    if (r.ok()) parse_slots(r, t, tp);
    sd.templates.push_back(t);
  }
  // Every id that can appear in a slot must have declined name forms.
  for (const auto& n : d.crew) {
    if (r.ok() && sd.names.count(n.id) == 0) r.fail(p + ".names", "нет форм имени для " + n.id);
  }
  for (const auto& z : d.zones) {
    if (r.ok() && sd.names.count(z.id) == 0) r.fail(p + ".names", "нет форм названия для " + z.id);
  }
  for (const auto& it : d.items) {
    if (r.ok() && sd.names.count(it.id) == 0) r.fail(p + ".names", "нет форм названия для " + it.id);
  }
  for (const auto& s : d.sensors) {
    if (r.ok() && sd.names.count(s.id) == 0) r.fail(p + ".names", "нет форм названия для " + s.id);
  }
}

void load_director(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "director";
  r.check_format(v, p, "zero-echo.director.v1");
  DirectorData& dd = d.director;
  const Value& t = r.obj(v, "tension", p);
  const std::string tp = p + ".tension";
  dd.tension_initial = r.num(t, "initial", tp);
  dd.decay_per_s = r.num(t, "decay_per_s", tp);
  dd.evaluate_every_s = r.num(t, "evaluate_every_s", tp);
  dd.max_tension = r.num(t, "max_tension", tp);
  dd.emergency_tension = r.num(t, "emergency_tension", tp);
  dd.calm_window_s = r.num(t, "calm_window_after_emergency_s", tp);
  dd.min_gap_s = r.num(t, "min_gap_between_events_s", tp, false, 60.0);
  if (r.ok() && dd.evaluate_every_s <= 0) r.fail(tp + ".evaluate_every_s", "должно быть > 0");
  dd.allowed_effect_types = r.strs(v, "allowed_effect_types", p);
  for (const auto& e : dd.allowed_effect_types) {
    // The core itself refuses any director capability beyond instruments, interpretation and sound.
    if (r.ok() && !contains(kDirectorEffectTypes, e)) r.fail(p + ".allowed_effect_types", "запрещённый тип эффекта " + e);
  }
  dd.emergency_task_actions = r.strs(v, "emergency_task_actions", p, false);
  const auto& events = r.arr(v, "events", p);
  for (std::size_t i = 0; i < events.size() && r.ok(); ++i) {
    const std::string ep = idx(p + ".events", i);
    const Value& e = events[i];
    DirectorEventDef ev;
    ev.id = r.str(e, "id", ep);
    ev.label_ru = r.str(e, "label_ru", ep);
    ev.level = r.str(e, "level", ep, false, "medium");
    ev.tension_cost = r.num(e, "tension_cost", ep);
    ev.max_tension_before = r.num(e, "max_tension_before", ep, false, 1.0);
    ev.cooldown_s = r.num(e, "cooldown_s", ep);
    ev.chance = r.num(e, "chance", ep);
    const Value& sw = r.obj(e, "story_window", ep);
    ev.window_from_s = r.num(sw, "from_s", ep + ".story_window");
    ev.window_to_s = r.num(sw, "to_s", ep + ".story_window");
    const auto& rf = r.arr(e, "requires_facts", ep, false);
    for (std::size_t k = 0; k < rf.size() && r.ok(); ++k) {
      DirectorFactReq req;
      req.holder = r.str(rf[k], "holder", idx(ep + ".requires_facts", k));
      req.fact = r.str(rf[k], "fact", idx(ep + ".requires_facts", k));
      if (r.ok() && d.fact(req.fact) == nullptr) r.fail(idx(ep + ".requires_facts", k), "неизвестный факт");
      if (r.ok() && req.holder != "player" && req.holder != "witness" && req.holder != "any") {
        r.fail(idx(ep + ".requires_facts", k), "holder: player|witness|any");
      }
      ev.requires_facts.push_back(req);
    }
    ev.incompatible = r.strs(e, "incompatible", ep, false);
    ev.witness_candidates = r.strs(e, "witness_candidates", ep, false);
    ev.witness_zones = r.strs(e, "witness_zones", ep, false);
    ev.tags = r.strs(e, "tags", ep, false);
    for (const auto& w : ev.witness_candidates) {
      if (r.ok() && d.npc(w) == nullptr) r.fail(ep + ".witness_candidates", "неизвестный персонаж " + w);
    }
    const Value& pre = r.obj(e, "preconditions", ep, false);
    const std::string pp = ep + ".preconditions";
    ev.no_emergency = r.boolean(pre, "no_emergency", pp, false, true);
    ev.no_task_near = r.strs(pre, "no_emergency_task_near", pp, false);
    ev.min_since_last_echo_s = r.num(pre, "min_since_last_echo_s", pp, false, 0.0);
    ev.witness_idle = r.boolean(pre, "witness_idle", pp, false, true);
    if (const Value* zc = pre.find("zone_checked"); zc != nullptr) {
      ev.zone_checked = r.str(*zc, "zone", pp + ".zone_checked");
      ev.zone_checked_fact = r.str(*zc, "fact", pp + ".zone_checked");
    }
    const auto& effects = r.arr(e, "effects", ep);
    for (std::size_t k = 0; k < effects.size() && r.ok(); ++k) {
      const std::string fp = idx(ep + ".effects", k);
      DirectorEffect ef;
      ef.type = r.str(effects[k], "type", fp);
      if (r.ok() && !contains(dd.allowed_effect_types, ef.type)) {
        r.fail(fp + ".type", "директор не может применять эффект " + ef.type);
        break;
      }
      if (ef.type == "sound") {
        ef.zone = r.str(effects[k], "zone", fp);
        ef.cue = r.str(effects[k], "cue", fp);
        ef.text_ru = r.str(effects[k], "text_ru", fp, false);
        if (r.ok() && d.zone(ef.zone) == nullptr) r.fail(fp + ".zone", "неизвестная зона");
      } else if (ef.type == "instrument_distortion") {
        ef.sensor = r.str(effects[k], "sensor", fp);
        ef.value = r.num(effects[k], "value", fp);
        ef.trend = r.str(effects[k], "trend", fp);
        ef.duration_s = r.num(effects[k], "duration_s", fp);
        ef.cue = r.str(effects[k], "cue", fp, false);
        if (r.ok() && d.sensor(ef.sensor) == nullptr) r.fail(fp + ".sensor", "неизвестный датчик");
        if (r.ok() && ef.duration_s <= 0) r.fail(fp + ".duration_s", "искажение должно быть временным");
      } else if (ef.type == "interpretation") {
        ef.fact = r.str(effects[k], "fact", fp, false);
        ef.holder = r.str(effects[k], "holder", fp);
        ef.source = r.str(effects[k], "source", fp);
        ef.text_ru = r.str(effects[k], "text_ru", fp);
        ef.confidence = r.num(effects[k], "confidence", fp, false, 0.5);
        if (r.ok() && !ef.fact.empty()) {
          const FactDef* f = d.fact(ef.fact);
          if (f == nullptr) r.fail(fp + ".fact", "неизвестный факт");
          else if (f->layer != "interpretation" || f->is_protected) {
            r.fail(fp + ".fact", "директор может выдавать только факты слоя interpretation");
          }
        }
        if (r.ok() && ef.holder != "witness") r.fail(fp + ".holder", "интерпретация выдаётся только свидетелю");
      }
      ev.effects.push_back(ef);
    }
    if (const Value* ini = e.find("initiative"); ini != nullptr && ini->is_object()) {
      ev.has_initiative = true;
      ev.initiative_situation_ru = r.str(*ini, "situation_ru", ep + ".initiative");
      ev.initiative_focus = r.str(*ini, "focus", ep + ".initiative", false);
    }
    const Value& rec = r.obj(e, "recovery", ep);
    ev.recovery_after_s = r.num(rec, "after_s", ep + ".recovery");
    ev.recovery_type = r.str(rec, "type", ep + ".recovery");
    if (r.ok() && ev.recovery_type != "none" && ev.recovery_type != "restore_instruments") {
      r.fail(ep + ".recovery.type", "ожидалось none|restore_instruments");
    }
    dd.events.push_back(ev);
  }
  unique_ids(r, dd.events, p + ".events");
  for (const auto& ev : dd.events) {
    for (const auto& other : ev.incompatible) {
      bool found = false;
      for (const auto& e2 : dd.events) found = found || e2.id == other;
      if (r.ok() && !found) r.fail(p + ".events." + ev.id + ".incompatible", "неизвестное событие " + other);
    }
  }
}

void load_biography(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "biography";
  r.check_format(v, p, "zero-echo.biography.v1");
  BiographyData& b = d.biography;
  b.min_clearance_m = r.num(v, "min_clearance_m", p);
  b.max_details_per_zone = static_cast<int>(r.num(v, "max_details_per_zone", p));
  b.blocked_roles = r.strs(v, "blocked_roles", p);
  const Value& anchors = r.obj(v, "anchors", p);
  for (const auto& m : anchors.members()) {
    const std::string ap = p + ".anchors." + m.key;
    BioAnchor a;
    a.id = m.key;
    a.zone = r.str(m.value, "zone", ap);
    a.role = r.str(m.value, "role", ap);
    if (!r.ok()) break;
    const ZoneDef* z = d.zone(a.zone);
    if (z == nullptr) r.fail(ap + ".zone", "неизвестная зона");
    else if (!contains(z->anchors, a.id)) r.fail(ap, "якорь не принадлежит зоне " + a.zone + " в world.zones");
    b.anchors[a.id] = a;
  }
  const Value& owners = r.obj(v, "tool_owner", p, false);
  for (const auto& m : owners.members()) {
    if (!m.value.is_string() || d.item(m.key) == nullptr || d.npc(m.value.as_string()) == nullptr) {
      r.fail(p + ".tool_owner." + m.key, "ожидалась пара инструмент → персонаж");
      break;
    }
    b.tool_owner[m.key] = m.value.as_string();
  }
  const auto& details = r.arr(v, "details", p);
  for (std::size_t i = 0; i < details.size() && r.ok(); ++i) {
    const std::string dp = idx(p + ".details", i);
    BioDetailDef bd;
    bd.id = r.str(details[i], "id", dp);
    bd.label_ru = r.str(details[i], "label_ru", dp);
    bd.roles = r.strs(details[i], "roles", dp);
    bd.collision = r.boolean(details[i], "collision", dp, false, false);
    bd.priority = static_cast<int>(r.num(details[i], "priority", dp, false, 1));
    const Value& trig = r.obj(details[i], "trigger", dp);
    bd.journal_kind = r.str(trig, "journal", dp + ".trigger");
    bd.min_count = static_cast<int>(r.num(trig, "min_count", dp + ".trigger", false, 1));
    bd.pair = r.strs(trig, "pair", dp + ".trigger", false);
    bd.by_non_owner = r.boolean(trig, "by_non_owner", dp + ".trigger", false, false);
    bd.with_companion = r.boolean(trig, "with_companion", dp + ".trigger", false, false);
    bd.actor = r.str(trig, "actor", dp + ".trigger", false);
    bd.place = r.str(details[i], "place", dp);
    bd.place_actor = r.str(details[i], "place_actor", dp, false);
    if (!r.ok()) break;
    if (!contains(kJournalKinds, bd.journal_kind)) r.fail(dp + ".trigger.journal", "неизвестный вид записи журнала");
    if (bd.place != "work_zone" && bd.place != "tool_home" && bd.place != "home_zone_of" && bd.place != "actor_home") {
      r.fail(dp + ".place", "ожидалось work_zone|tool_home|home_zone_of|actor_home");
    }
    if (r.ok() && bd.place == "home_zone_of" && d.npc(bd.place_actor) == nullptr) r.fail(dp + ".place_actor", "неизвестный персонаж");
    if (r.ok() && !bd.actor.empty() && d.npc(bd.actor) == nullptr) r.fail(dp + ".trigger.actor", "неизвестный персонаж");
    for (const auto& role : bd.roles) {
      if (r.ok() && contains(b.blocked_roles, role)) r.fail(dp + ".roles", "деталь не может занимать роль " + role);
    }
    for (const auto& a : bd.pair) {
      if (r.ok() && d.npc(a) == nullptr) r.fail(dp + ".trigger.pair", "неизвестный персонаж " + a);
    }
    b.details.push_back(bd);
  }
  unique_ids(r, b.details, p + ".details");
}

void load_layout(Reader& r, const Value& v, StaticData& d) {
  const std::string p = "layout";
  auto read_points = [&](std::string_view key, std::map<std::string, std::array<double, 3>>& out) {
    const Value& o = r.obj(v, key, p);
    for (const auto& m : o.members()) {
      if (!m.value.is_array() || m.value.size() != 3) {
        r.fail(p + "." + std::string(key) + "." + m.key, "ожидалась точка [x, y, z]");
        return;
      }
      out[m.key] = {m.value.at(0).as_number(), m.value.at(1).as_number(), m.value.at(2).as_number()};
    }
  };
  read_points("anchors", d.layout.anchors);
  read_points("zone_stand_points", d.layout.stand_points);
  d.layout.present = r.ok();
}

void cross_validate(Reader& r, StaticData& d) {
  for (const auto& [actor, seeds] : d.initial_knowledge) {
    if (r.ok() && d.npc(actor) == nullptr) r.fail("world.initial_knowledge." + actor, "неизвестный персонаж");
  }
  for (const auto& [actor, ops] : d.initial_opinions) {
    if (r.ok() && d.npc(actor) == nullptr) r.fail("world.initial_opinions." + actor, "неизвестный персонаж");
  }
  for (const auto& t : d.triggers) {
    for (const auto& rv : t.reveal) {
      for (const auto& to : rv.to) {
        if (r.ok() && d.npc(to) == nullptr) r.fail("world.scripted_triggers." + t.id, "неизвестный получатель " + to);
      }
    }
    if (r.ok() && t.has_initiative && d.npc(t.initiative_actor) == nullptr) {
      r.fail("world.scripted_triggers." + t.id + ".initiative", "неизвестный персонаж");
    }
  }
  for (const auto& ir : d.inspection_reveals) {
    if (r.ok() && d.kind_of(ir.target).empty()) r.fail("world.inspection_reveals", "неизвестная цель " + ir.target);
  }
}

}  // namespace

double NpcDef::skill(const std::string& name) const {
  for (const auto& [k, v] : skills) {
    if (k == name) return v;
  }
  return 0.0;
}

const std::string& NameForms::form(const std::string& c) const {
  if (c == "gen") return gen;
  if (c == "dat") return dat;
  if (c == "acc") return acc;
  if (c == "ins") return ins;
  if (c == "prep") return prep;
  return nom;
}

template <typename T>
static const T* find_by_id(const std::vector<T>& v, const std::string& id) {
  for (const auto& x : v) {
    if (x.id == id) return &x;
  }
  return nullptr;
}

const ZoneDef* StaticData::zone(const std::string& id) const { return find_by_id(zones, id); }
const DoorDef* StaticData::door(const std::string& id) const { return find_by_id(doors, id); }
const ResourceDef* StaticData::resource(const std::string& id) const { return find_by_id(resources, id); }
const ItemDef* StaticData::item(const std::string& id) const { return find_by_id(items, id); }
const SensorDef* StaticData::sensor(const std::string& id) const { return find_by_id(sensors, id); }
const FactDef* StaticData::fact(const std::string& id) const { return find_by_id(facts, id); }
const ActionDef* StaticData::action(const std::string& id) const { return find_by_id(actions, id); }
const NpcDef* StaticData::npc(const std::string& id) const { return find_by_id(crew, id); }

std::string StaticData::label(const std::string& id) const {
  if (const auto* z = zone(id)) return z->name_ru;
  if (const auto* it = item(id)) return it->name_ru;
  if (const auto* s = sensor(id)) return s->name_ru;
  if (const auto* n = npc(id)) return n->name_ru;
  if (const auto* r = resource(id)) return r->name_ru;
  return id;
}

std::string StaticData::kind_of(const std::string& id) const {
  if (zone(id) != nullptr) return "zone";
  if (item(id) != nullptr) return "item";
  if (sensor(id) != nullptr) return "sensor";
  if (npc(id) != nullptr) return "actor";
  return "";
}

std::string StaticData::home_zone_of(const std::string& id) const {
  if (zone(id) != nullptr) return id;
  if (const auto* it = item(id)) return it->zone;
  if (const auto* s = sensor(id)) return s->zone;
  if (const auto* n = npc(id)) return n->zone;
  return "";
}

bool load_static_data(const json::Value& data, StaticData& out, std::string& error) {
  error.clear();
  StaticData d;
  Reader r(error);
  if (!data.is_object()) return r.fail("data", "ожидался объект {world, npcs, actions, profiles, speech, director, biography}");
  static const std::vector<std::string> kKeys = {"world", "npcs", "actions", "profiles", "speech", "director", "biography", "layout"};
  for (const auto& m : data.members()) {
    if (!contains(kKeys, m.key)) return r.fail("data." + m.key, "неизвестный раздел данных");
  }
  load_world(r, r.obj(data, "world", "data"), d);
  if (r.ok()) load_npcs(r, r.obj(data, "npcs", "data"), d);
  if (r.ok()) load_actions(r, r.obj(data, "actions", "data"), d);
  if (r.ok()) load_profiles(r, r.obj(data, "profiles", "data"), d);
  if (r.ok()) load_speech(r, r.obj(data, "speech", "data"), d);
  if (r.ok()) load_director(r, r.obj(data, "director", "data"), d);
  if (r.ok()) load_biography(r, r.obj(data, "biography", "data"), d);
  if (r.ok() && data.has("layout")) load_layout(r, r.obj(data, "layout", "data"), d);
  if (r.ok()) cross_validate(r, d);
  if (!r.ok()) return false;
  d.data_hash = "fnv1a64:" + hex64(fnv1a64(json::dump_canonical(data)));
  out = std::move(d);
  return true;
}

}  // namespace echo
