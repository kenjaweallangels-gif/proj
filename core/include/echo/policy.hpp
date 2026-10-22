// UtilityPolicy — the ordinary game AI (Документ §8, SPEC §5). Deterministic choice among the actions the game
// offers, scored by persona weights, role, world state and memory. It is a complete NPC brain without any
// model: rules_propose and every fallback use it, and its output passes the same Intent Authority checks.
#pragma once

#include <string>

#include "echo/context.hpp"
#include "echo/state.hpp"

namespace echo {

struct PolicyChoice {
  Proposal proposal;
  std::string why_ru;          // short explanation for traces
  std::string refusal_reason;  // reason code when the choice is `refuse` (power_budget, secret, eva_fatigue, ...)
  double score = 0.0;
};

PolicyChoice choose(const Core& c, const std::string& actor, const Situation& sit, const Offer& offer);

// Classifies a player utterance (keywords from data/speech_ru.json) and finds a target mentioned in it.
std::string classify_utterance(const Core& c, const std::string& text, std::string& target_hint);
// Resolves an alias hit like "*sensor" to a concrete entity using the situation (faulty sensor first).
std::string resolve_target_hint(const Core& c, const std::string& actor, const std::string& hint);

// Best free companion for `actor` among `candidates` (relationship, fatigue, relevant skill); "" when none.
std::string best_companion(const Core& c, const std::string& actor, const std::vector<std::string>& candidates,
                           const std::string& exclude, const std::string& ignore_plan);

// Why `actor` should refuse in `sit`, from the game rules (secret, power budget, the rule the order breaks).
// Returns a reason code (see rules.hpp) or "" when nothing forbids the request.
std::string refusal_reason_for(const Core& c, const std::string& actor, const Situation& sit);

// Periodic observations that start initiatives (medic notices fatigue, geologist protects a sample, ...).
void observe(Core& c, double now_ms);
// Follow-ups after a task completes (e.g. repair once a sensor drift is confirmed).
void on_task_completed(Core& c, const Task& task, const std::vector<std::string>& revealed, double now_ms);

}  // namespace echo
