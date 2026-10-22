#include "echo/metrics.hpp"

#include <algorithm>
#include <cmath>

namespace echo {
namespace {

json::Value latency_json(const LatencySet& l) {
  if (l.values.empty()) return json::Value("unavailable");
  return percentiles_json(percentiles(l.values));
}

json::Value counter_map(const std::map<std::string, std::uint64_t>& m) {
  json::Value v = json::Value::object();
  for (const auto& [k, n] : m) v.set(k, static_cast<double>(n));
  return v;
}

json::Value frame_block(const std::vector<FrameSampleRec>& samples, double budget_ms, double pause_ms) {
  json::Value v = json::Value::object();
  v.set("count", static_cast<double>(samples.size()));
  if (samples.empty()) {
    v.set("frame_interval", "unavailable");
    v.set("cpu", "unavailable");
    v.set("gpu", "unavailable");
    v.set("frame_ready", "unavailable");
    v.set("missed_deadline_ratio", json::Value());
    v.set("pauses_over_33ms", 0);
    v.set("max_pause_ms", json::Value());
    return v;
  }
  std::vector<double> interval, cpu, gpu, ready;
  std::size_t missed = 0, pauses = 0;
  double max_interval = 0;
  for (const auto& s : samples) {
    interval.push_back(s.interval_ms);
    cpu.push_back(s.cpu_ms);
    if (s.gpu_ms >= 0) gpu.push_back(s.gpu_ms);
    ready.push_back(s.gpu_ms >= 0 ? std::max(s.cpu_ms, s.gpu_ms) : s.cpu_ms);
    if (s.interval_ms > budget_ms) ++missed;
    if (s.interval_ms > pause_ms) ++pauses;
    max_interval = std::max<double>(max_interval, s.interval_ms);
  }
  v.set("frame_interval", percentiles_json(percentiles(interval)));
  v.set("cpu", percentiles_json(percentiles(cpu)));
  // Without GPU timestamps there is no GPU time: never substitute CPU time.
  v.set("gpu", gpu.empty() ? json::Value("unavailable") : percentiles_json(percentiles(gpu)));
  v.set("frame_ready", percentiles_json(percentiles(ready)));
  v.set("missed_deadline_ratio", static_cast<double>(missed) / static_cast<double>(samples.size()));
  v.set("pauses_over_33ms", static_cast<double>(pauses));
  v.set("max_pause_ms", max_interval);
  return v;
}

}  // namespace

PercentileSet percentiles(std::vector<double> values) {
  PercentileSet p;
  if (values.empty()) return p;
  std::sort(values.begin(), values.end());
  auto rank = [&](double q) {
    const auto r = static_cast<std::size_t>(std::ceil(q * static_cast<double>(values.size())));
    return values[std::min(values.size() - 1, r == 0 ? 0 : r - 1)];
  };
  p.p50 = rank(0.50);
  p.p95 = rank(0.95);
  p.p99 = rank(0.99);
  p.max = values.back();
  double sum = 0;
  for (const double v : values) sum += v;
  p.mean = sum / static_cast<double>(values.size());
  p.count = values.size();
  return p;
}

json::Value percentiles_json(const PercentileSet& p) {
  json::Value v = json::Value::object();
  v.set("p50", p.p50);
  v.set("p95", p.p95);
  v.set("p99", p.p99);
  v.set("max", p.max);
  v.set("mean", p.mean);
  v.set("count", static_cast<double>(p.count));
  return v;
}

json::Value frame_report(const Core& c) {
  const double budget = c.data.profiles.frame_budget_ms;
  const double pause = c.data.profiles.pause_threshold_ms;
  json::Value v = frame_block(c.rt.frames.warm, budget, pause);
  v.set("cold", frame_block(c.rt.frames.cold, budget, pause));
  v.set("budget_ms", budget);
  v.set("pause_threshold_ms", pause);
  v.set("source", "host_samples");
  v.set("note_ru",
        "Отчёт по сэмплам, переданным хостом. Интервал rAF — ритм представления, а не чистое GPU-время; "
        "SwiftShader/CPU-адаптер не является доказательством 60 FPS.");
  return v;
}

json::Value ai_report(const Core& c) {
  const AiMetrics& m = c.rt.ai;
  json::Value v = json::Value::object();
  json::Value req = json::Value::object();
  req.set("queued", static_cast<double>(m.queued));
  req.set("dispatched", static_cast<double>(m.dispatched));
  req.set("replaced", static_cast<double>(m.replaced));
  req.set("evicted", static_cast<double>(m.evicted));
  req.set("results", static_cast<double>(m.results));
  req.set("by_backend", counter_map(m.by_backend));
  req.set("by_kind", counter_map(m.by_kind));
  v.set("requests", req);
  json::Value lat = json::Value::object();
  lat.set("first_token", latency_json(m.first_token));
  lat.set("ready", latency_json(m.ready));
  lat.set("provider_total", latency_json(m.provider_total));
  lat.set("queue_wait", latency_json(m.queue_wait));
  lat.set("note_ru", "first_token — от провайдера; ready — от постановки запроса до проверенного ответа (часы хоста).");
  v.set("latency_ms", lat);
  v.set("verdicts", counter_map(m.verdicts));
  json::Value fb = json::Value::object();
  fb.set("count", static_cast<double>(m.fallbacks));
  // Share of queued AI requests that ended with the ordinary game AI instead of a model answer.
  fb.set("ratio_of_requests", m.queued > 0 ? json::Value(static_cast<double>(m.fallbacks) / static_cast<double>(m.queued)) : json::Value());
  fb.set("by_reason", counter_map(m.fallback_reasons));
  v.set("fallback", fb);
  v.set("invalid_intents", static_cast<double>(m.invalid_intents));
  v.set("violations_admitted", static_cast<double>(m.violations_admitted));
  v.set("violation_log", json::Value::string_array(m.violation_log));
  json::Value sp = json::Value::object();
  sp.set("lines", static_cast<double>(m.speech_lines));
  sp.set("repeated", static_cast<double>(m.speech_repeated));
  sp.set("repetition_rate", m.speech_lines > 0 ? static_cast<double>(m.speech_repeated) / static_cast<double>(m.speech_lines) : 0.0);
  sp.set("by_kind", counter_map(m.speech_by_kind));
  v.set("speech", sp);
  json::Value tok = json::Value::object();
  tok.set("input", static_cast<double>(m.input_tokens));
  tok.set("output", static_cast<double>(m.output_tokens));
  tok.set("cached_input", static_cast<double>(m.cached_tokens));
  tok.set("reasoning", static_cast<double>(m.reasoning_tokens));
  tok.set("measured_results", static_cast<double>(m.measured_results));
  tok.set("estimated_results", static_cast<double>(m.estimated_results));
  v.set("tokens", tok);
  json::Value cost = json::Value::object();
  cost.set("total_usd", m.results_with_cost > 0 ? json::Value(m.cost_usd) : json::Value());
  cost.set("results_with_cost", static_cast<double>(m.results_with_cost));
  cost.set("fictional", m.cost_fictional);
  v.set("cost", cost);
  std::vector<std::string> models(m.models_seen.begin(), m.models_seen.end());
  v.set("models_seen", json::Value::string_array(models));
  return v;
}

}  // namespace echo
