#include "echo/admission.hpp"

#include <algorithm>
#include <cmath>

#include "echo/authority.hpp"
#include "echo/context.hpp"
#include "echo/speech.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

constexpr std::size_t kMaxStoredFrames = 250000;

std::string deadline_kind(const std::string& kind) {
  if (kind == "order_response" || kind == "emergency") return "direct_reply";
  return kind;
}

double percentile(std::vector<double> v, double q) {
  if (v.empty()) return -1;
  std::sort(v.begin(), v.end());
  const auto rank = static_cast<std::size_t>(std::ceil(q * static_cast<double>(v.size())));
  return v[std::min(v.size() - 1, rank == 0 ? 0 : rank - 1)];
}

void window_metrics(const GateState& g, double& p95_gpu, double& p99_frame) {
  std::vector<double> gpu, ready;
  for (const auto& s : g.window) {
    if (s.gpu_ms >= 0) gpu.push_back(s.gpu_ms);
    // Frame readiness: the later of CPU submission and GPU completion; CPU alone when GPU time is unknown.
    ready.push_back(s.gpu_ms >= 0 ? std::max<double>(s.cpu_ms, s.gpu_ms) : s.cpu_ms);
  }
  p95_gpu = percentile(gpu, 0.95);
  p99_frame = percentile(ready, 0.99);
}

std::string backend_lane(const std::string& backend) {
  if (backend == "cpu" || backend == "gpu") return "local";
  if (backend == "remote") return "remote";
  return "";
}

void say_immediate(Core& c, const std::string& actor_id, const Situation& sit, json::Value& out) {
  SpeechRequest req;
  req.actor = actor_id;
  req.kind = "immediate";
  req.stage = "react";
  req.situation = speech_situation(c, sit);
  req.say_intent = sit.say_intent;
  req.style = c.st.emergency ? "concerned" : "neutral";
  Speech s = render_speech(c, req);
  say(c, s, kSrcSim);
  out = speech_json(s);
}

void canned_ambient(Core& c, const QueueItem& item) {
  SpeechRequest req;
  req.actor = item.actor;
  req.stage = "ambient";
  req.situation = "calm";
  req.style = "neutral";
  Speech s = render_speech(c, req);
  if (s.template_id != "core.minimal") say(c, s, kSrcSim);
}

}  // namespace

std::string effective_mode(const Core& c) {
  if (c.rt.config.mode == "extended" && c.st.emergency) return "live";
  return c.rt.config.mode;
}

int cpu_thread_pool(const Core& c) {
  const AdmissionConfig& a = c.data.profiles.admission;
  if (c.rt.config.cpu_cores <= 0) return a.cpu_threads_min;  // unknown CPU: the conservative minimum
  return std::clamp(c.rt.config.cpu_cores - 2, 0, a.cpu_threads_max);  // physical cores minus 2
}

int active_generations(const Core& c, const std::string& lane) {
  int n = 0;
  for (const auto& [id, r] : c.st.requests) {
    if (r.state == "pending" && backend_lane(r.backend) == lane) ++n;
  }
  return n;
}

GateEval evaluate_gate(const Core& c, double now_ms) {
  GateEval g;
  const GpuGateConfig& cfg = c.data.profiles.admission.gate;
  const GateState& gs = c.rt.gate;
  window_metrics(gs, g.p95_gpu_ms, g.p99_frame_ms);
  g.vram_free_gib = gs.vram_free_gib;
  g.stable_s = gs.good_streak && gs.have_stats ? std::max(0.0, (now_ms - gs.good_since_ms) / 1000.0) : 0.0;
  g.cooldown_remaining_s = std::max(0.0, (gs.cooldown_until_ms - now_ms) / 1000.0);
  auto deny = [&](const std::string& code, const std::string& reason) {
    g.codes.push_back(code);
    g.reasons.push_back(reason);
  };
  if (!c.rt.config.gpu_enabled) deny("gpu_disabled", "GPU-генерация выключена в настройках");
  if (!c.rt.config.calibrated) deny("not_calibrated", "нет калибровки совместной нагрузки рендер + модель");
  const std::string mode = effective_mode(c);
  if (mode == "smooth") deny("mode_smooth", "режим «Приоритет плавности» не допускает GPU-LLM");
  if (!gs.have_stats) {
    deny("no_stats", "нет статистики кадров");
  } else if (now_ms - gs.last_stats_ms > cfg.stats_max_age_s * 1000.0) {
    deny("stats_stale", "статистика кадров устарела (" + format_number_ru(std::round((now_ms - gs.last_stats_ms) / 100.0) / 10.0) +
                            " с > " + format_number_ru(cfg.stats_max_age_s) + " с)");
  }
  if (gs.have_stats) {
    if (g.p95_gpu_ms < 0) {
      deny("gpu_timing_unavailable", "нет GPU timestamp: время GPU неизвестно, подмена CPU-временем запрещена");
    } else if (!(g.p95_gpu_ms < cfg.p95_gpu_ms_max)) {
      deny("p95_gpu_high", "p95 GPU " + format_number_ru(std::round(g.p95_gpu_ms * 100) / 100) + " мс ≥ " +
                               format_number_ru(cfg.p95_gpu_ms_max) + " мс");
    }
    if (g.p99_frame_ms >= 0 && !(g.p99_frame_ms < cfg.p99_frame_ms_max)) {
      deny("p99_frame_high", "p99 готовности кадра " + format_number_ru(std::round(g.p99_frame_ms * 100) / 100) + " мс ≥ " +
                                 format_number_ru(cfg.p99_frame_ms_max) + " мс");
    }
  }
  if (g.vram_free_gib < 0) deny("vram_unknown", "свободная VRAM неизвестна — GPU-генерация запрещена");
  else if (g.vram_free_gib < cfg.vram_reserve_gib_min) {
    deny("vram_low", "свободно " + format_number_ru(std::round(g.vram_free_gib * 100) / 100) + " GiB < резерва " +
                         format_number_ru(cfg.vram_reserve_gib_min) + " GiB");
  }
  if (g.cooldown_remaining_s > 0) {
    deny("cooldown", "охлаждение после ухудшения кадров: ещё " + format_number_ru(std::round(g.cooldown_remaining_s * 10) / 10) + " с");
  }
  if (gs.have_stats && g.stable_s < cfg.stable_window_s) {
    deny("unstable", "стабильные кадры " + format_number_ru(std::round(g.stable_s * 10) / 10) + " с < " +
                         format_number_ru(cfg.stable_window_s) + " с");
  }
  g.gpu_allowed = g.codes.empty();
  return g;
}

json::Value gate_json(const GateEval& g) {
  json::Value v = json::Value::object();
  v.set("gpu_allowed", g.gpu_allowed);
  v.set("reasons", json::Value::string_array(g.reasons));
  v.set("codes", json::Value::string_array(g.codes));
  v.set("p95_gpu_ms", g.p95_gpu_ms < 0 ? json::Value() : json::Value(g.p95_gpu_ms));
  v.set("p99_frame_ms", g.p99_frame_ms < 0 ? json::Value() : json::Value(g.p99_frame_ms));
  v.set("vram_free_gib", g.vram_free_gib < 0 ? json::Value() : json::Value(g.vram_free_gib));
  v.set("stable_s", g.stable_s);
  v.set("cooldown_remaining_s", g.cooldown_remaining_s);
  return v;
}

json::Value decision_json(const Core& c, const Decision& d, double now_ms) {
  json::Value v = json::Value::object();
  v.set("allowed", d.allowed);
  v.set("backend", d.backend);
  v.set("code", d.code);
  v.set("reason", d.reason);
  v.set("gate", gate_json(evaluate_gate(c, now_ms)));
  return v;
}

EnqueueResult enqueue_request(Core& c, const std::string& actor_id, const std::string& kind, Situation sit, double now_ms,
                              bool immediate_reaction) {
  EnqueueResult res;
  const AdmissionConfig& cfg = c.data.profiles.admission;
  const int priority = cfg.priority.at(kind == "order_response" ? "direct_reply" : kind);
  const double deadline = now_ms + cfg.deadline_ms.at(deadline_kind(kind));
  if (immediate_reaction) say_immediate(c, actor_id, sit, res.immediate);

  if (kind == "emergency") {
    // Emergency reactions never wait for a model: the ordinary game AI answers through the same authority.
    const std::string task_id = format_id("req-", c.st.next_req++, 6);
    FallbackResult fb = apply_fallback(c, task_id, actor_id, sit, "emergency_rules", now_ms);
    res.resolved = verdict_json(task_id, actor_id, fb.eval.status, &fb.eval, nullptr, "", {});
    res.decision = {true, "rules", "emergency_rules", "аварийная реакция не ждёт модель: сразу обычный игровой ИИ"};
    return res;
  }

  // Replace a stale, not yet started request of the same NPC (or keep the more important one).
  for (auto it = c.st.queue.begin(); it != c.st.queue.end(); ++it) {
    if (it->actor != actor_id) continue;
    if (priority >= it->priority) {
      json::Value p = json::Value::object();
      p.set("old", it->task_id);
      p.set("new", format_id("req-", c.st.next_req, 6));
      emit(c, "request_replaced", actor_id, std::move(p), kSrcSim);
      c.rt.ai.replaced++;
      c.st.queue.erase(it);
    } else {
      if (it->situation.focus.empty()) it->situation.focus = sit.focus;
      res.decision = {false, "", "superseded",
                      "у персонажа " + name_of(c, actor_id) + " уже ждёт более важный запрос " + it->task_id +
                          " — новое событие будет учтено в нём"};
      return res;
    }
    break;
  }

  QueueItem item;
  item.task_id = format_id("req-", c.st.next_req++, 6);
  item.actor = actor_id;
  item.kind = kind;
  item.priority = priority;
  item.created_ms = now_ms;
  item.deadline_ms = deadline;
  item.revision = c.st.revision;
  item.situation = std::move(sit);
  c.st.queue.push_back(item);
  c.rt.ai.queued++;
  c.rt.ai.by_kind[kind]++;
  json::Value qp = json::Value::object();
  qp.set("task_id", item.task_id);
  qp.set("kind", kind);
  qp.set("priority", priority);
  qp.set("deadline_ms", deadline - now_ms);
  emit(c, "request_queued", actor_id, std::move(qp), kSrcSim);

  // Bounded queue: evict the lowest priority (ambient first, oldest first among equals).
  bool evicted_new = false;
  if (static_cast<int>(c.st.queue.size()) > cfg.max_queue_length) {
    std::size_t victim = 0;
    for (std::size_t i = 1; i < c.st.queue.size(); ++i) {
      const QueueItem& q = c.st.queue[i];
      const QueueItem& v = c.st.queue[victim];
      if (q.priority < v.priority || (q.priority == v.priority && q.created_ms < v.created_ms)) victim = i;
    }
    const QueueItem gone = c.st.queue[victim];
    c.st.queue.erase(c.st.queue.begin() + static_cast<std::ptrdiff_t>(victim));
    evicted_new = gone.task_id == item.task_id;
    c.rt.ai.evicted++;
    json::Value ep = json::Value::object();
    ep.set("task_id", gone.task_id);
    ep.set("kind", gone.kind);
    emit(c, "request_evicted", gone.actor, std::move(ep), kSrcSim);
    if (gone.kind == "ambient") canned_ambient(c, gone);
    else apply_fallback(c, gone.task_id, gone.actor, gone.situation, "queue_overflow", now_ms);
  }
  if (evicted_new) {
    res.decision = {false, "", "queue_full", "очередь ИИ заполнена — для этого события использована готовая реакция"};
    return res;
  }
  json::Value q = json::Value::object();
  q.set("task_id", item.task_id);
  q.set("kind", kind);
  q.set("priority", priority);
  res.queued = q;
  std::size_t position = 1;
  for (const auto& other : c.st.queue) {
    if (other.task_id != item.task_id && other.priority >= priority) ++position;
  }
  res.decision = {true, "", "queued",
                  "поставлено в очередь: позиция " + std::to_string(position) + " из " + std::to_string(c.st.queue.size()) +
                      "; ответ нужен за " + format_number_ru(deadline - now_ms) + " мс, иначе — обычный игровой ИИ"};
  return res;
}

DispatchResult dispatch(Core& c, const std::string& backend, double now_ms) {
  DispatchResult out;
  expire_requests(c, now_ms);
  const AdmissionConfig& cfg = c.data.profiles.admission;
  out.decision.backend = backend;
  auto deny = [&](const std::string& code, const std::string& reason) {
    out.decision.allowed = false;
    out.decision.code = code;
    out.decision.reason = reason;
    return out;
  };
  if (backend == "cpu" && cpu_thread_pool(c) < cfg.cpu_threads_min) {
    return deny("cpu_insufficient", "CPU-пул " + std::to_string(cpu_thread_pool(c)) + " потоков < минимума " +
                                        std::to_string(cfg.cpu_threads_min) + " при запасе 2 ядра для игры");
  }
  if (backend == "remote" && c.rt.config.privacy_profile == "offline") {
    return deny("privacy_offline", "профиль приватности offline: отправка разговоров наружу запрещена");
  }
  if (backend == "gpu") {
    const GateEval g = evaluate_gate(c, now_ms);
    if (!g.gpu_allowed) return deny(g.codes.front(), "GPU запрещён: " + join(g.reasons, "; "));
  }
  const std::string lane = backend_lane(backend);
  if (!lane.empty() && active_generations(c, lane) >= cfg.max_active_generations) {
    return deny("busy", "уже идёт генерация: одна активная на общий экземпляр модели");
  }
  if (c.st.queue.empty()) return deny("idle", "очередь пуста");
  std::size_t best = 0;
  for (std::size_t i = 1; i < c.st.queue.size(); ++i) {
    const QueueItem& q = c.st.queue[i];
    const QueueItem& b = c.st.queue[best];
    if (q.priority > b.priority || (q.priority == b.priority && q.created_ms < b.created_ms)) best = i;
  }
  const QueueItem item = c.st.queue[best];
  c.st.queue.erase(c.st.queue.begin() + static_cast<std::ptrdiff_t>(best));
  PendingRequest rec;
  rec.task_id = item.task_id;
  rec.actor = item.actor;
  rec.kind = item.kind;
  rec.backend = backend;
  rec.created_ms = item.created_ms;
  rec.dispatched_ms = now_ms;
  rec.deadline_ms = item.deadline_ms;
  rec.world_revision = c.st.revision;
  rec.situation = item.situation;
  rec.request = build_gateway_request(c, item, now_ms);
  out.request = rec.request;
  c.st.requests[rec.task_id] = rec;
  c.rt.ai.dispatched++;
  c.rt.ai.by_backend[backend]++;
  c.rt.ai.queue_wait.values.push_back(now_ms - item.created_ms);
  json::Value p = json::Value::object();
  p.set("task_id", item.task_id);
  p.set("backend", backend);
  p.set("revision", static_cast<double>(c.st.revision));
  emit(c, "request_dispatched", item.actor, std::move(p), kSrcSim);
  out.decision.allowed = true;
  out.decision.code = "dispatched";
  out.decision.reason = "выдан запрос " + item.task_id + " (" + name_of(c, item.actor) + ", " + item.kind + ") исполнителю «" +
                        backend + "»; осталось " + format_number_ru(std::floor(item.deadline_ms - now_ms)) + " мс";
  return out;
}

std::vector<std::string> expire_requests(Core& c, double now_ms) {
  std::vector<std::string> expired;
  // Queued items whose deadline passed before any model saw them.
  std::vector<QueueItem> late;
  for (auto it = c.st.queue.begin(); it != c.st.queue.end();) {
    if (now_ms > it->deadline_ms) {
      late.push_back(*it);
      it = c.st.queue.erase(it);
    } else {
      ++it;
    }
  }
  for (const auto& q : late) {
    expired.push_back(q.task_id);
    json::Value p = json::Value::object();
    p.set("task_id", q.task_id);
    p.set("where", "queue");
    emit(c, "request_expired", q.actor, std::move(p), kSrcSim);
    apply_fallback(c, q.task_id, q.actor, q.situation, "deadline_in_queue", now_ms);
  }
  std::vector<std::string> due;
  for (const auto& [id, r] : c.st.requests) {
    if (r.state == "pending" && now_ms > r.deadline_ms) due.push_back(id);
  }
  for (const auto& id : due) {
    PendingRequest& r = c.st.requests.at(id);
    r.state = "expired";
    r.resolution = "timeout";
    expired.push_back(id);
    json::Value p = json::Value::object();
    p.set("task_id", id);
    p.set("where", "provider");
    emit(c, "request_expired", r.actor, std::move(p), kSrcSim);
    c.rt.ai.verdicts["expired"]++;
    apply_fallback(c, id, r.actor, r.situation, "timeout", now_ms);
    compact_resolved_request(c.st.requests.at(id));
  }
  return expired;
}

bool cancel_request(Core& c, const std::string& task_id, double now_ms) {
  for (auto it = c.st.queue.begin(); it != c.st.queue.end(); ++it) {
    if (it->task_id != task_id) continue;
    const QueueItem q = *it;
    c.st.queue.erase(it);
    json::Value p = json::Value::object();
    p.set("task_id", task_id);
    emit(c, "request_cancelled", q.actor, std::move(p), kSrcPlayer);
    apply_fallback(c, task_id, q.actor, q.situation, "cancelled", now_ms);
    return true;
  }
  const auto it = c.st.requests.find(task_id);
  if (it == c.st.requests.end() || it->second.state != "pending") return false;
  it->second.state = "cancelled";
  it->second.resolution = "cancelled";
  json::Value p = json::Value::object();
  p.set("task_id", task_id);
  emit(c, "request_cancelled", it->second.actor, std::move(p), kSrcPlayer);
  const Situation sit = it->second.situation;
  const std::string actor_id = it->second.actor;
  compact_resolved_request(it->second);
  apply_fallback(c, task_id, actor_id, sit, "cancelled", now_ms);
  return true;
}

void ingest_frame_stats(Core& c, const std::vector<FrameSampleRec>& samples, double vram_free_gib, bool vram_known,
                        double now_ms, bool cold) {
  auto& store = cold ? c.rt.frames.cold : c.rt.frames.warm;
  for (const auto& s : samples) {
    if (store.size() < kMaxStoredFrames) store.push_back(s);
  }
  const GpuGateConfig& cfg = c.data.profiles.admission.gate;
  GateState& g = c.rt.gate;
  double batch_ms = 0;
  for (const auto& s : samples) {
    g.window.push_back(s);
    batch_ms += s.interval_ms;
  }
  // Keep the newest samples covering the stability window.
  const double window_ms = cfg.stable_window_s * 1000.0;
  double covered = 0;
  for (const auto& s : g.window) covered += s.interval_ms;
  while (g.window.size() > 1 && covered - g.window.front().interval_ms >= window_ms) {
    covered -= g.window.front().interval_ms;
    g.window.pop_front();
  }
  g.vram_free_gib = vram_known ? vram_free_gib : -1;
  g.have_stats = true;
  g.last_stats_ms = now_ms;
  double p95 = -1, p99 = -1;
  window_metrics(g, p95, p99);
  const bool bad = (p95 >= 0 && !(p95 < cfg.p95_gpu_ms_max)) || (p99 >= 0 && !(p99 < cfg.p99_frame_ms_max));
  if (bad) {
    // Degradation: no new GPU requests and a cooldown before the gate may reopen.
    g.cooldown_until_ms = now_ms + cfg.cooldown_s * 1000.0;
    g.good_streak = false;
    g.degraded = true;
    g.last_bad_ms = now_ms;
  } else {
    if (!g.good_streak) {
      g.good_streak = true;
      g.good_since_ms = std::max(now_ms - batch_ms, g.last_bad_ms);
    }
    g.degraded = false;
  }
}

}  // namespace echo
