// AdmissionController (Документ §11, SPEC §3): one generation at a time on the shared model instance,
// replacement of stale unstarted requests of the same NPC, a bounded queue (ambient evicted first),
// emergency bypass straight to rules, and the GPU gate driven by fresh frame statistics. Every decision
// carries a human-readable Russian reason for the UI.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

struct Decision {
  bool allowed = false;
  std::string backend, code, reason;
};

struct GateEval {
  bool gpu_allowed = false;
  std::vector<std::string> codes, reasons;
  double p95_gpu_ms = -1, p99_frame_ms = -1, vram_free_gib = -1;  // < 0: unknown
  double stable_s = 0, cooldown_remaining_s = 0;
};

GateEval evaluate_gate(const Core& c, double now_ms);
json::Value gate_json(const GateEval& g);
json::Value decision_json(const Core& c, const Decision& d, double now_ms);

// Effective AI mode: `extended` is forbidden during an emergency and falls back to `live`.
std::string effective_mode(const Core& c);
int cpu_thread_pool(const Core& c);

struct EnqueueResult {
  json::Value queued;     // {task_id, kind, priority} or null
  json::Value immediate;  // Speech or null
  Decision decision;
  json::Value resolved;   // for emergencies: the verdict produced immediately by rules
};
EnqueueResult enqueue_request(Core& c, const std::string& actor, const std::string& kind, Situation sit, double now_ms,
                              bool immediate_reaction);

struct DispatchResult {
  json::Value request;  // GatewayRequest or null
  Decision decision;
};
DispatchResult dispatch(Core& c, const std::string& backend, double now_ms);

// Queued or dispatched requests past their deadline: fallback applied, task ids returned.
std::vector<std::string> expire_requests(Core& c, double now_ms);
// Cancels a queued or dispatched request; the NPC falls back to ordinary behaviour; late answers are discarded.
bool cancel_request(Core& c, const std::string& task_id, double now_ms);

// Number of dispatched, unresolved generations on the local model (cpu/gpu) or remote lane.
int active_generations(const Core& c, const std::string& lane);

// Frame statistics feed (frame_stats command): updates the GPU gate window and the metrics store.
void ingest_frame_stats(Core& c, const std::vector<FrameSampleRec>& samples, double vram_free_gib, bool vram_known,
                        double now_ms, bool cold);

}  // namespace echo
