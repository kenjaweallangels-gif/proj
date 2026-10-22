// Intent Authority (Документ §12, SPEC §2): the only path by which an NPC proposal — from a model, from the
// rules policy or as a fallback — can change the world. Seven steps with a per-step trace:
//   1 format   2 pending   3 revision   4 validity   5 reserve   6 execute   7 record
// The model proposes, the game checks, the world changes only after acceptance and actual execution.
#pragma once

#include <string>
#include <vector>

#include "echo/context.hpp"
#include "echo/speech.hpp"
#include "echo/state.hpp"

namespace echo {

inline constexpr std::size_t kIntentMaxBytes = 2048;
inline constexpr int kIntentMaxDepth = 4;
inline constexpr std::int64_t kPlanTtlMs = 60000;

struct StepTrace {
  int step = 0;
  std::string name, detail;
  bool ok = false;
  bool skipped = false;
};

// Step 1 alone: strict parsing of raw proposal text against the request's offer.
bool parse_intent(const Core& c, std::string_view text, const Offer& offer, Proposal& out, std::vector<std::string>& reasons);
std::string proposal_text(const Proposal& p);  // canonical JSON text of a proposal (what the rules policy "says")
json::Value proposal_json(const Proposal& p);

// Step 4 alone: every game rule for `actor` proposing `p` given what was offered. Empty = valid.
std::vector<std::string> check_validity(const Core& c, const std::string& actor, const Proposal& p, const Offer* offer,
                                        const std::string& ignore_plan);
// Step 3 alone: dependencies of the proposal whose semantic revision is newer than `world_revision`.
std::vector<std::string> stale_dependencies(const Core& c, const std::string& actor, const Proposal& p,
                                            std::int64_t world_revision);

struct Evaluation {
  std::string status;  // accepted | awaiting_player | rejected | stale | duplicate | expired
  bool parsed = false;
  Proposal proposal;
  std::vector<StepTrace> steps;
  std::vector<std::string> reasons;
  std::string plan_id, world_task_id;
  int failed_step = 0;
};

struct EvalInput {
  std::string task_id, actor;  // actor comes from the host's request record, never from the proposal
  std::string text;            // raw proposal text (model output or serialized rules proposal)
  const Offer* offer = nullptr;
  const PendingRequest* record = nullptr;  // step 2 checks it (null + !is_fallback => unknown task)
  std::int64_t world_revision = 0;
  Situation situation;
  std::string source;          // agent_accepted | fallback | player
  std::string provider, model;
  std::string fallback_reason; // for fallbacks: why the core closed the request itself
  double now_ms = 0;
  bool is_fallback = false;    // step 2 is satisfied by the host for fallbacks
  bool dry_run = false;        // stop after step 4 without changing anything (benchmarks)
};

// Runs the seven steps. Commits reservations/plans/tasks only when every check passes.
Evaluation evaluate(Core& c, const EvalInput& in);

// Fallback: the ordinary game AI builds a valid proposal from a FRESH offer and it passes the same steps.
struct FallbackResult {
  Evaluation eval;
  Speech speech;
  bool has_speech = false;
};
// `emit_verdict`: log a `verdict` event (callers that build their own verdict pass false).
FallbackResult apply_fallback(Core& c, const std::string& task_id, const std::string& actor, const Situation& sit,
                              const std::string& reason, double now_ms, bool emit_verdict = true);

// Full handling of a provider result (submit_result). Returns {verdict, speech|null, events} parts.
struct SubmitOutcome {
  json::Value verdict;
  json::Value speech;  // null when nothing is said (duplicate / unknown task)
};
SubmitOutcome submit_result(Core& c, const json::Value& result, double now_ms);

// Player decision on a plan (accept | reject | reassign | ask_evidence).
SubmitOutcome decide_plan(Core& c, const std::string& plan_id, const std::string& decision, const std::string& companion,
                          double now_ms, std::string& error_code, std::string& error_message);

// Releases a plan's soft reservations (reject / expiry / cancel).
void release_plan(Core& c, Plan& plan, const std::string& new_state);
// Expires plans past their TTL (called from tick).
void expire_plans(Core& c, double now_ms);

json::Value steps_json(const std::vector<StepTrace>& steps);
json::Value verdict_json(const std::string& task_id, const std::string& actor, const std::string& status,
                         const Evaluation* model, const Evaluation* fallback, const std::string& fallback_reason,
                         const std::vector<std::string>& reasons);

// Invariant auditor: counts admitted violations (target 0) after every state-changing step.
void audit_invariants(Core& c, const std::string& where);

}  // namespace echo
