#include "echo/engine.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <map>

#include "echo/admission.hpp"
#include "echo/authority.hpp"
#include "echo/context.hpp"
#include "echo/metrics.hpp"
#include "echo/persist.hpp"
#include "echo/policy.hpp"
#include "echo/rules.hpp"
#include "echo/sim.hpp"
#include "echo/tasks.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

using json::Value;

constexpr std::size_t kMaxUtterance = 600;
constexpr std::size_t kMaxSamplesPerCall = 100000;

struct CmdError {
  std::string code, message;
  bool set = false;
  void fail(std::string c, std::string m) {
    if (set) return;
    code = std::move(c);
    message = std::move(m);
    set = true;
  }
};

// Typed accessors for command arguments; the first problem is reported as invalid_argument.
class Args {
 public:
  Args(const Value& req, CmdError& err) : req_(req), err_(err) {}

  std::string str(const char* key, bool required = true, std::size_t max_bytes = 4096) {
    const Value* v = req_.find(key);
    if (v == nullptr || (v->is_null() && !required)) {
      if (required) err_.fail("invalid_argument", std::string("нет аргумента ") + key);
      return "";
    }
    if (!v->is_string()) {
      err_.fail("invalid_argument", std::string(key) + ": ожидалась строка");
      return "";
    }
    if (v->as_string().size() > max_bytes) {
      err_.fail("invalid_argument", std::string(key) + ": слишком длинная строка");
      return "";
    }
    return v->as_string();
  }

  double number(const char* key, bool required = true, double fallback = 0.0) {
    const Value* v = req_.find(key);
    if (v == nullptr) {
      if (required) err_.fail("invalid_argument", std::string("нет аргумента ") + key);
      return fallback;
    }
    if (!v->is_number()) {
      err_.fail("invalid_argument", std::string(key) + ": ожидалось число");
      return fallback;
    }
    return v->as_number();
  }

  bool boolean(const char* key, bool required = true, bool fallback = false) {
    const Value* v = req_.find(key);
    if (v == nullptr) {
      if (required) err_.fail("invalid_argument", std::string("нет аргумента ") + key);
      return fallback;
    }
    if (!v->is_bool()) {
      err_.fail("invalid_argument", std::string(key) + ": ожидалось true/false");
      return fallback;
    }
    return v->as_bool();
  }

  std::string one_of(const char* key, const std::vector<std::string>& allowed, bool required = true, const std::string& fallback = "") {
    if (!required && !req_.has(key)) return fallback;
    const std::string v = str(key, required);
    if (!err_.set && !contains(allowed, v)) err_.fail("invalid_argument", std::string(key) + ": ожидалось одно из " + join(allowed, "|"));
    return v;
  }

  const Value& obj(const char* key) {
    static const Value kEmpty = Value::object();
    const Value* v = req_.find(key);
    if (v == nullptr || !v->is_object()) {
      err_.fail("invalid_argument", std::string(key) + ": ожидался объект");
      return kEmpty;
    }
    return *v;
  }

  const Value& arr(const char* key) {
    static const Value kEmpty = Value::array();
    const Value* v = req_.find(key);
    if (v == nullptr || !v->is_array()) {
      err_.fail("invalid_argument", std::string(key) + ": ожидался массив");
      return kEmpty;
    }
    return *v;
  }

  double now_ms() {
    const double v = number("now_ms");
    if (!err_.set && !(v >= 0)) err_.fail("invalid_argument", "now_ms: ожидалось неотрицательное число");
    return v;
  }

 private:
  const Value& req_;
  CmdError& err_;
};

Value ok_response() {
  Value v = Value::object();
  v.set("ok", true);
  return v;
}

Value events_out(const Core& c) {
  Value arr = Value::array();
  for (const std::size_t i : c.rt.out_events) arr.push(event_json_ru(c, c.st.events[i]));
  return arr;
}

// GatewayResult envelope per schemas/gateway_result.schema.json (the proposal itself is checked by authority).
std::string validate_result(const Value& r) {
  if (!r.is_object()) return "result: ожидался объект";
  static const std::vector<std::string> kKeys = {"task_id", "status", "proposal_text", "usage", "latency_ms", "provider", "model",
                                                 "provider_revision", "finish_reason", "attempts", "cost_usd", "cost_is_fictional", "error"};
  static const std::vector<std::string> kStatus = {"ok", "timeout", "refused", "invalid_output", "unavailable", "rate_limited",
                                                   "budget_exceeded", "cancelled"};
  for (const auto& m : r.members()) {
    if (!contains(kKeys, m.key)) return "result: неизвестное поле " + m.key;
  }
  for (const char* k : {"task_id", "status", "provider", "model", "finish_reason"}) {
    if (!r[k].is_string()) return std::string("result.") + k + ": ожидалась строка";
  }
  if (!contains(kStatus, r["status"].as_string())) return "result.status: неизвестный статус";
  const Value* pt = r.find("proposal_text");
  if (pt == nullptr || !(pt->is_null() || pt->is_string())) return "result.proposal_text: строка или null";
  if (pt->is_string() && pt->as_string().size() > 8192) return "result.proposal_text: длиннее 8192";
  if (!r["attempts"].is_integer() || r["attempts"].as_int() < 0) return "result.attempts: целое ≥ 0";
  const Value& u = r["usage"];
  if (!u.is_object()) return "result.usage: ожидался объект";
  for (const auto& m : u.members()) {
    if (m.key != "input_tokens" && m.key != "output_tokens" && m.key != "cached_input_tokens" && m.key != "reasoning_tokens" &&
        m.key != "measured") {
      return "result.usage: неизвестное поле " + m.key;
    }
  }
  if (!u["input_tokens"].is_integer() || !u["output_tokens"].is_integer() || !u["measured"].is_bool()) {
    return "result.usage: нужны input_tokens, output_tokens (целые) и measured";
  }
  for (const char* k : {"cached_input_tokens", "reasoning_tokens"}) {
    if (u.has(k) && !u[k].is_integer()) return std::string("result.usage.") + k + ": целое";
  }
  const Value& l = r["latency_ms"];
  if (!l.is_object() || !l["total"].is_number()) return "result.latency_ms.total: ожидалось число";
  for (const auto& m : l.members()) {
    if (m.key == "total") continue;
    if (m.key == "first_token" && (m.value.is_null() || m.value.is_number())) continue;
    if (m.key == "queue" && m.value.is_number()) continue;
    return "result.latency_ms: неверное поле " + m.key;
  }
  if (r.has("provider_revision") && !(r["provider_revision"].is_null() || r["provider_revision"].is_string())) {
    return "result.provider_revision: строка или null";
  }
  if (r.has("cost_usd") && !(r["cost_usd"].is_null() || r["cost_usd"].is_number())) return "result.cost_usd: число или null";
  if (r.has("cost_is_fictional") && !r["cost_is_fictional"].is_bool()) return "result.cost_is_fictional: true/false";
  if (r.has("error") && !(r["error"].is_null() || r["error"].is_object())) return "result.error: объект или null";
  return "";
}

Value memory_entry_json(const MemoryEntry& m) {
  Value v = Value::object();
  v.set("id", m.id);
  v.set("kind", m.kind);
  v.set("text_ru", m.text_ru);
  v.set("source", m.source);
  if (m.confidence >= 0) v.set("confidence", m.confidence);
  v.set("importance", m.importance);
  v.set("time_s", static_cast<double>(m.time_ms) / 1000.0);
  v.set("tags", Value::string_array(m.tags));
  return v;
}

Value config_json(const Core& c) {
  Value v = Value::object();
  v.set("mode", c.rt.config.mode);
  v.set("effective_mode", effective_mode(c));
  v.set("gpu_enabled", c.rt.config.gpu_enabled);
  v.set("calibrated", c.rt.config.calibrated);
  v.set("privacy_profile", c.rt.config.privacy_profile);
  v.set("cpu_cores", c.rt.config.cpu_cores > 0 ? Value(c.rt.config.cpu_cores) : Value());
  v.set("cpu_threads", cpu_thread_pool(c));
  v.set("deadline_scale", c.rt.config.deadline_scale);
  v.set("max_active_generations", c.data.profiles.admission.max_active_generations);
  Value notes = Value::array();
  if (c.rt.config.mode == "extended" && c.st.emergency) notes.push("«Расширенный разговор» запрещён во время аварии: действует режим «Живые диалоги».");
  if (c.rt.config.privacy_profile == "offline") notes.push("offline: удалённые исполнители запрещены, разговоры не покидают устройство.");
  if (c.rt.config.cpu_cores <= 0) notes.push("число ядер CPU неизвестно: CPU-пул по минимуму.");
  if (c.rt.config.deadline_scale > 1.0) notes.push("сроки ответа модели увеличены хостом сверх целевых 2,5 с (Документ §11): режим демонстрации удалённого API.");
  v.set("notes_ru", notes);
  return v;
}

// ---------- commands ----------

Value cmd_tick(Core& c, Args& a, CmdError& err) {
  const double dt_s = a.number("dt_s");
  const double now = a.now_ms();
  if (!err.set && !(dt_s >= 0 && dt_s <= 1.0)) err.fail("invalid_argument", "dt_s: от 0 до 1.0 с");
  if (err.set) return Value();
  const auto expired = sim_tick(c, static_cast<std::int64_t>(std::llround(dt_s * 1000.0)), now);
  audit_invariants(c, "tick");
  Value r = ok_response();
  r.set("events", events_out(c));
  r.set("revision", static_cast<double>(c.st.revision));
  r.set("expired", Value::string_array(expired));
  r.set("sim_time_s", static_cast<double>(c.st.sim_ms) / 1000.0);
  return r;
}

Value cmd_state(Core& c, Args& a, CmdError& err) {
  const bool debug = a.boolean("debug", false, false);
  const double now = a.number("now_ms", false, c.st.last_now_ms);
  const bool with_hash = a.boolean("hash", false, true);  // pass false when polling every frame
  if (err.set) return Value();
  Value r = snapshot_json(c, debug, now, with_hash);
  r.set("ok", true);
  return r;
}

std::string npc_arg(const Core& c, Args& a, CmdError& err) {
  const std::string npc = a.str("npc_id");
  if (!err.set && !is_npc(c, npc)) err.fail("not_found", "нет NPC " + npc);
  return npc;
}

Value enqueue_response(Core& c, const EnqueueResult& e, double now) {
  Value r = ok_response();
  r.set("queued", e.queued);
  r.set("immediate", e.immediate);
  r.set("admission", decision_json(c, e.decision, now));
  if (!e.resolved.is_null()) r.set("resolved", e.resolved);
  r.set("events", events_out(c));
  return r;
}

Value cmd_player_say(Core& c, Args& a, CmdError& err) {
  const std::string npc = npc_arg(c, a, err);
  const std::string text = a.str("text", true, kMaxUtterance * 4);
  const double now = a.now_ms();
  if (!err.set && utf8_length(text) > kMaxUtterance) err.fail("invalid_argument", "text: не длиннее 600 символов");
  if (err.set) return Value();
  Value p = Value::object();
  p.set("npc", npc);
  p.set("text", text);
  emit(c, "player_said", c.data.player_id, std::move(p), kSrcPlayer);
  Situation sit;
  sit.origin = "player_say";
  sit.utterance = text;
  std::string hint;
  sit.say_intent = classify_utterance(c, text, hint);
  sit.focus = resolve_target_hint(c, npc, hint);
  const EnqueueResult e = enqueue_request(c, npc, "direct_reply", sit, now, true);
  Value r = enqueue_response(c, e, now);
  r.set("say_intent", sit.say_intent);
  return r;
}

Value cmd_player_order(Core& c, Args& a, CmdError& err) {
  const std::string npc = npc_arg(c, a, err);
  const std::string action = a.str("action");
  const std::string target = a.str("target_id", false);
  const std::string companion = a.str("companion_id", false);
  const double now = a.now_ms();
  if (!err.set && c.data.action(action) == nullptr) err.fail("invalid_argument", "неизвестное действие " + action);
  if (!err.set && !target.empty() && c.data.kind_of(target).empty()) err.fail("invalid_argument", "неизвестная цель " + target);
  if (!err.set && !companion.empty() && !is_npc(c, companion)) err.fail("invalid_argument", "неизвестный напарник " + companion);
  if (err.set) return Value();
  Value p = Value::object();
  p.set("npc", npc);
  p.set("action", action);
  p.set("target", target);
  p.set("companion", companion);
  emit(c, "player_ordered", c.data.player_id, std::move(p), kSrcPlayer);
  Situation sit;
  sit.origin = "player_order";
  sit.say_intent = "order";
  sit.has_order = true;
  sit.order.action = action;
  sit.order.target = target;
  sit.order.companion = companion;
  sit.order.style = "neutral";
  sit.focus = target;
  const EnqueueResult e = enqueue_request(c, npc, "order_response", sit, now, true);
  return enqueue_response(c, e, now);
}

Value cmd_player_decide(Core& c, Args& a, CmdError& err) {
  const std::string plan_id = a.str("plan_id");
  const std::string decision = a.one_of("decision", {"accept", "reject", "reassign", "ask_evidence"});
  const std::string companion = a.str("companion_id", false);
  const double now = a.now_ms();
  if (err.set) return Value();
  std::string code, message;
  const SubmitOutcome out = decide_plan(c, plan_id, decision, companion, now, code, message);
  if (!code.empty()) {
    err.fail(code, message);
    return Value();
  }
  Value r = ok_response();
  r.set("verdict", out.verdict);
  r.set("speech", out.speech);
  r.set("events", events_out(c));
  return r;
}

Value cmd_dispatch(Core& c, Args& a, CmdError& err) {
  const double now = a.now_ms();
  const std::string backend = a.one_of("backend", {"rules", "cpu", "gpu", "remote"});
  if (err.set) return Value();
  const DispatchResult d = dispatch(c, backend, now);
  Value r = ok_response();
  r.set("request", d.request);
  r.set("decision", decision_json(c, d.decision, now));
  r.set("events", events_out(c));
  return r;
}

Value cmd_submit_result(Core& c, Args& a, CmdError& err) {
  const Value& result = a.obj("result");
  const double now = a.now_ms();
  if (err.set) return Value();
  const std::string problem = validate_result(result);
  if (!problem.empty()) {
    err.fail("invalid_result", problem);
    return Value();
  }
  const SubmitOutcome out = submit_result(c, result, now);
  Value r = ok_response();
  r.set("verdict", out.verdict);
  r.set("speech", out.speech);
  r.set("events", events_out(c));
  return r;
}

Value cmd_rules_propose(Core& c, Args& a, CmdError& err) {
  const std::string task_id = a.str("task_id");
  if (err.set) return Value();
  Offer offer;
  Situation sit;
  std::string actor_id;
  if (const auto it = c.st.requests.find(task_id); it != c.st.requests.end() && it->second.state == "pending") {
    offer = offer_from_request(it->second.request);
    sit = it->second.situation;
    actor_id = it->second.actor;
  } else {
    for (const auto& q : c.st.queue) {
      if (q.task_id != task_id) continue;
      offer = compute_offer(c, q.actor, q.situation);
      sit = q.situation;
      actor_id = q.actor;
    }
  }
  if (actor_id.empty()) {
    err.fail("not_found", "запрос " + task_id + " не ожидает ответа");
    return Value();
  }
  const PolicyChoice choice = choose(c, actor_id, sit, offer);
  Value r = ok_response();
  r.set("task_id", task_id);
  r.set("proposal_text", proposal_text(choice.proposal));
  r.set("why_ru", choice.why_ru);
  r.set("score", choice.score);
  return r;
}

Value cmd_cancel(Core& c, Args& a, CmdError& err) {
  const std::string task_id = a.str("task_id");
  const double now = a.now_ms();
  if (err.set) return Value();
  bool cancelled = false;
  if (starts_with(task_id, "task-")) cancelled = cancel_task(c, task_id, "cancelled_by_host");
  else cancelled = cancel_request(c, task_id, now);
  Value r = ok_response();
  r.set("cancelled", cancelled);
  r.set("events", events_out(c));
  return r;
}

Value cmd_frame_stats(Core& c, Args& a, CmdError& err, const Value& req) {
  const Value& samples = a.arr("samples");
  const double now = a.now_ms();
  const std::string phase = a.one_of("phase", {"warm", "cold"}, false, "warm");
  if (!err.set && samples.size() > kMaxSamplesPerCall) err.fail("invalid_argument", "samples: слишком много за один вызов");
  std::vector<FrameSampleRec> recs;
  for (std::size_t i = 0; i < samples.size() && !err.set; ++i) {
    const Value& s = samples.at(i);
    const Value& interval = s["interval_ms"];
    const Value& cpu = s["cpu_ms"];
    const Value* gpu = s.find("gpu_ms");
    if (!s.is_object() || !interval.is_number() || !cpu.is_number() || interval.as_number() < 0 || cpu.as_number() < 0 ||
        (gpu != nullptr && !gpu->is_null() && !(gpu->is_number() && gpu->as_number() >= 0))) {
      err.fail("invalid_argument", "samples[" + std::to_string(i) + "]: нужны interval_ms, cpu_ms ≥ 0 и gpu_ms (число или null)");
      break;
    }
    FrameSampleRec r;
    r.interval_ms = static_cast<float>(interval.as_number());
    r.cpu_ms = static_cast<float>(cpu.as_number());
    r.gpu_ms = gpu != nullptr && gpu->is_number() ? static_cast<float>(gpu->as_number()) : -1.0f;
    recs.push_back(r);
  }
  const Value* vram = req.find("vram_free_gib");
  if (!err.set && vram != nullptr && !vram->is_null() && !vram->is_number()) err.fail("invalid_argument", "vram_free_gib: число или null");
  if (err.set) return Value();
  const bool vram_known = vram != nullptr && vram->is_number();
  ingest_frame_stats(c, recs, vram_known ? vram->as_number() : -1.0, vram_known, now, phase == "cold");
  Value r = ok_response();
  r.set("gate", gate_json(evaluate_gate(c, now)));
  if (c.rt.gate.degraded) {
    // Advice for the host: already running GPU generations should be cancelled at a safe boundary.
    std::vector<std::string> active;
    for (const auto& [id, req_rec] : c.st.requests) {
      if (req_rec.state == "pending" && req_rec.backend == "gpu") active.push_back(id);
    }
    Value adv = Value::object();
    adv.set("cancel_gpu", Value::string_array(active));
    adv.set("reason_ru", "кадры ухудшились: новые GPU-запросы запрещены, включено охлаждение");
    r.set("advice", adv);
  }
  return r;
}

Value cmd_set_ai_mode(Core& c, Args& a, CmdError& err) {
  const std::string mode = a.one_of("mode", {"smooth", "live", "extended"});
  const bool gpu = a.boolean("gpu_enabled");
  const bool calibrated = a.boolean("calibrated");
  const std::string privacy = a.one_of("privacy_profile", {"offline", "hybrid", "online"});
  const double cores = a.number("cpu_cores", false, static_cast<double>(c.rt.config.cpu_cores));
  if (!err.set && !(cores >= 0 && cores <= 1024 && std::trunc(cores) == cores)) err.fail("invalid_argument", "cpu_cores: целое ≥ 0");
  const double scale = a.number("deadline_scale", false, c.rt.config.deadline_scale);
  if (!err.set && !(scale >= 1.0 && scale <= 8.0)) err.fail("invalid_argument", "deadline_scale: число от 1 до 8");
  if (err.set) return Value();
  c.rt.config.mode = mode;
  c.rt.config.gpu_enabled = gpu;
  c.rt.config.calibrated = calibrated;
  c.rt.config.privacy_profile = privacy;
  c.rt.config.cpu_cores = static_cast<int>(cores);
  c.rt.config.deadline_scale = scale;
  Value r = ok_response();
  r.set("config", config_json(c));
  return r;
}

Value cmd_metrics(Core& c) {
  Value r = ok_response();
  r.set("frame", frame_report(c));
  r.set("ai", ai_report(c));
  return r;
}

Value cmd_events(Core& c, Args& a, CmdError& err) {
  const double since = a.number("since_seq", false, 0);
  const double limit = a.number("limit", false, 1000);
  if (!err.set && (since < 0 || limit < 1)) err.fail("invalid_argument", "since_seq ≥ 0, limit ≥ 1");
  if (err.set) return Value();
  Value arr = Value::array();
  for (const auto& e : c.st.events) {
    if (static_cast<double>(e.seq) <= since) continue;
    if (static_cast<double>(arr.size()) >= std::min(limit, 10000.0)) break;
    arr.push(event_json_ru(c, e));
  }
  Value r = ok_response();
  r.set("events", arr);
  r.set("last_seq", c.st.events.empty() ? 0.0 : static_cast<double>(c.st.events.back().seq));
  return r;
}

Value cmd_memory(Core& c, Args& a, CmdError& err) {
  const std::string npc = a.str("npc_id");
  if (!err.set && c.data.npc(npc) == nullptr) err.fail("not_found", "нет персонажа " + npc);
  if (err.set) return Value();
  const ActorMemory& m = c.st.memory.at(npc);
  Value entries = Value::array();
  for (const auto& e : m.entries) entries.push(memory_entry_json(e));
  Value facts = Value::array();
  for (const auto& k : m.facts) {
    Value f = Value::object();
    f.set("id", k.fact);
    f.set("source", k.source);
    f.set("layer", c.data.fact(k.fact)->layer);
    f.set("time_s", static_cast<double>(k.time_ms) / 1000.0);
    facts.push(f);
  }
  Value r = ok_response();
  r.set("npc_id", npc);
  r.set("entries", entries);
  r.set("known_facts", facts);
  const ActorState& st = c.st.actors.at(npc);
  r.set("trust_player", st.trust_player);
  Value rel = Value::object();
  for (const auto& [k, v] : st.relationships) rel.set(k, v);
  r.set("relationships", rel);
  return r;
}

void apply_door_state(Core& c, const std::string& door_id, const std::string& state) {
  c.st.doors[door_id].state = state;
  c.st.sealed_zones.clear();
  for (const auto& z : c.data.zones) {
    bool has_door = false, all_sealed = true;
    for (const auto& d : c.data.doors) {
      if (d.a != z.id && d.b != z.id) continue;
      has_door = true;
      if (c.st.doors.at(d.id).state != "sealed") all_sealed = false;
    }
    if (has_door && all_sealed) c.st.sealed_zones.insert(z.id);
  }
}

Value cmd_debug_patch(Core& c, Args& a, CmdError& err) {
  const Value& patch = a.arr("patch");
  const double now = a.number("now_ms", false, c.st.last_now_ms);
  for (std::size_t i = 0; i < patch.size() && !err.set; ++i) {
    const Value& op = patch.at(i);
    CmdError& e = err;
    Args pa(op, e);
    const std::string kind = pa.str("op");
    if (e.set) break;
    if (kind == "set_actor_busy") {
      const std::string id = pa.str("actor");
      const bool busy = pa.boolean("busy");
      if (!e.set && actor(c, id) == nullptr) e.fail("not_found", "нет персонажа " + id);
      if (e.set) break;
      c.st.actors.at(id).debug_busy = busy;
      bump_revision(c, {id});
    } else if (kind == "set_resource") {
      const std::string id = pa.str("id");
      const double amount = pa.number("amount");
      if (!e.set && c.st.resources.count(id) == 0) e.fail("not_found", "нет ресурса " + id);
      if (!e.set && !(amount >= c.st.resources.at(id).reserved)) e.fail("invalid_argument", "запас не может быть меньше резерва");
      if (e.set) break;
      c.st.resources.at(id).amount = amount;
      bump_revision(c, {id});
    } else if (kind == "set_door") {
      const std::string id = pa.str("id");
      const std::string state = pa.one_of("state", {"open", "closed", "sealed"});
      if (!e.set && c.st.doors.count(id) == 0) e.fail("not_found", "нет двери " + id);
      if (e.set) break;
      apply_door_state(c, id, state);
      const DoorDef* d = c.data.door(id);
      bump_revision(c, {id, d->a, d->b});
    } else if (kind == "move_actor") {
      const std::string id = pa.str("actor");
      const std::string zone = pa.str("zone");
      if (!e.set && actor(c, id) == nullptr) e.fail("not_found", "нет персонажа " + id);
      if (!e.set && c.data.zone(zone) == nullptr) e.fail("not_found", "нет зоны " + zone);
      if (!e.set && !c.st.actors.at(id).task_id.empty()) e.fail("invalid_state", "персонаж выполняет задачу");
      if (e.set) break;
      c.st.actors.at(id).zone = zone;
      c.st.actors.at(id).walk = Travel{};
      bump_revision(c, {id});
    } else if (kind == "set_sensor_reading") {
      const std::string id = pa.str("id");
      const double value = pa.number("value");
      const std::string trend = pa.str("trend", false);
      if (!e.set && c.st.sensors.count(id) == 0) e.fail("not_found", "нет датчика " + id);
      if (e.set) break;
      c.st.sensors.at(id).reading = Reading{value, trend.empty() ? "stable" : trend};
      bump_revision(c, {id});
    } else if (kind == "set_fatigue") {
      const std::string id = pa.str("actor");
      const double value = pa.number("value");
      if (!e.set && actor(c, id) == nullptr) e.fail("not_found", "нет персонажа " + id);
      if (!e.set && !(value >= 0 && value <= 1)) e.fail("invalid_argument", "усталость 0..1");
      if (e.set) break;
      c.st.actors.at(id).fatigue = value;
    } else if (kind == "bump_revision") {
      const std::string entity = pa.str("entity", false);
      if (e.set) break;
      bump_revision(c, {entity});
    } else if (kind == "emergency") {
      const std::string id = pa.str("actor");
      const std::string text = pa.str("text_ru", false);
      if (!e.set && !is_npc(c, id)) e.fail("not_found", "нет NPC " + id);
      if (e.set) break;
      Situation sit;
      sit.origin = "emergency";
      sit.text_ru = text;
      sit.focus = c.st.emergency_sensor;
      enqueue_request(c, id, "emergency", sit, now, false);
    } else {
      e.fail("invalid_argument", "неизвестная операция " + kind);
    }
  }
  if (err.set) return Value();
  Value p = Value::object();
  p.set("ops", static_cast<double>(patch.size()));
  emit(c, "debug_patch", "", std::move(p), kSrcPlayer);
  audit_invariants(c, "debug_patch");
  Value r = ok_response();
  r.set("revision", static_cast<double>(c.st.revision));
  r.set("events", events_out(c));
  return r;
}

Value cmd_version() {
  Value r = ok_response();
  r.set("core_version", kCoreVersion);
  r.set("prompt_version", kPromptVersion);
  r.set("intent_schema_version", kIntentSchemaVersion);
  r.set("save_format", kSaveFormat);
  return r;
}

}  // namespace

Value error_response(const std::string& code, const std::string& message) {
  Value v = Value::object();
  v.set("ok", false);
  Value e = Value::object();
  e.set("code", code);
  e.set("message", message);
  v.set("error", e);
  return v;
}

Engine::Engine() = default;
Engine::~Engine() = default;

std::string Engine::call(std::string_view request_json) {
  if (request_json.size() > kMaxRequestBytes) return json::dump(error_response("too_large", "запрос больше 8 МиБ"));
  Value req;
  json::ParseError perr;
  json::ParseLimits limits;
  limits.max_bytes = kMaxRequestBytes;
  limits.max_depth = 64;
  if (!json::parse(request_json, req, &perr, limits)) {
    return json::dump(error_response("bad_json", perr.code + ": " + perr.message + " (offset " + std::to_string(perr.offset) + ")"));
  }
  return json::dump(call_json(req));
}

Value Engine::call_json(const Value& req) {
  if (!req.is_object()) return error_response("bad_request", "запрос должен быть JSON-объектом");
  const Value* cmd_v = req.find("cmd");
  if (cmd_v == nullptr || !cmd_v->is_string()) return error_response("bad_request", "нет строкового поля cmd");
  const std::string cmd = cmd_v->as_string();
  CmdError err;
  Args args(req, err);
  if (cmd == "version") return cmd_version();
  if (cmd == "init") {
    const Value& data = args.obj("data");
    const double seed = args.number("seed", false, -1);
    if (!err.set && req.has("seed") && !(seed >= 0 && seed <= 9007199254740992.0 && std::trunc(seed) == seed)) {
      err.fail("invalid_argument", "seed: целое от 0 до 2^53");
    }
    if (err.set) return error_response(err.code, err.message);
    auto core = std::make_unique<Core>();
    std::string data_error;
    if (!load_static_data(data, core->data, data_error)) return error_response("data_invalid", data_error);
    init_state(*core, seed >= 0 ? static_cast<std::uint64_t>(seed) : core->data.world_seed);
    core->rt.out_events.clear();
    core_ = std::move(core);
    Value r = ok_response();
    r.set("revision", static_cast<double>(core_->st.revision));
    Value summary = Value::object();
    summary.set("zones", static_cast<double>(core_->data.zones.size()));
    summary.set("npcs", static_cast<double>(core_->data.crew.size() - 1));
    summary.set("facts", static_cast<double>(core_->data.facts.size()));
    summary.set("actions", static_cast<double>(core_->data.actions.size()));
    summary.set("speech_templates", static_cast<double>(core_->data.speech.templates.size()));
    summary.set("director_events", static_cast<double>(core_->data.director.events.size()));
    summary.set("layout", core_->data.layout.present);
    r.set("summary", summary);
    r.set("seed", static_cast<double>(core_->st.seed));
    r.set("data_hash", core_->data.data_hash);
    r.set("hash", state_hash(*core_));
    return r;
  }
  if (!core_) return error_response("not_initialized", "сначала init");
  Core& c = *core_;
  c.rt.out_events.clear();
  Value r;
  if (cmd == "tick") r = cmd_tick(c, args, err);
  else if (cmd == "state") r = cmd_state(c, args, err);
  else if (cmd == "player_say") r = cmd_player_say(c, args, err);
  else if (cmd == "player_order") r = cmd_player_order(c, args, err);
  else if (cmd == "player_decide") r = cmd_player_decide(c, args, err);
  else if (cmd == "dispatch") r = cmd_dispatch(c, args, err);
  else if (cmd == "submit_result") r = cmd_submit_result(c, args, err);
  else if (cmd == "rules_propose") r = cmd_rules_propose(c, args, err);
  else if (cmd == "cancel") r = cmd_cancel(c, args, err);
  else if (cmd == "frame_stats") r = cmd_frame_stats(c, args, err, req);
  else if (cmd == "set_ai_mode") r = cmd_set_ai_mode(c, args, err);
  else if (cmd == "metrics") r = cmd_metrics(c);
  else if (cmd == "events") r = cmd_events(c, args, err);
  else if (cmd == "memory") r = cmd_memory(c, args, err);
  else if (cmd == "save") {
    r = ok_response();
    r.set("save", make_save(c));
  } else if (cmd == "load") {
    const Value& save = args.obj("save");
    if (!err.set) {
      std::string code, message;
      if (!load_save(c, save, code, message)) {
        err.fail(code, message);
      } else {
        r = ok_response();
        r.set("revision", static_cast<double>(c.st.revision));
        r.set("hash", state_hash(c));
      }
    }
  } else if (cmd == "debug_patch") r = cmd_debug_patch(c, args, err);
  else if (cmd == "peek_request") {
    const std::string id = args.str("task_id");
    if (!err.set) {
      const auto it = c.st.requests.find(id);
      if (it == c.st.requests.end()) err.fail("not_found", "нет запроса " + id);
      else {
        r = ok_response();
        r.set("request", it->second.request);
        r.set("state", it->second.state);
      }
    }
  } else if (cmd == "hash") {
    r = ok_response();
    r.set("hash", state_hash(c));
    r.set("revision", static_cast<double>(c.st.revision));
  } else {
    return error_response("unknown_cmd", "неизвестная команда " + cmd);
  }
  if (err.set) return error_response(err.code, err.message);
  return r;
}

}  // namespace echo
