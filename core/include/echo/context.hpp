// ContextBuilder (Документ §10, SPEC §4): builds the GatewayRequest for one NPC from the game state.
// Everything the model may know is in the request: persona, situation, the actions/targets/companions the
// game offers right now, the NPC's own relevant non-protected facts, a memory excerpt and recent events —
// each layer within its token budget (estimate ceil(codepoints/3.2), labelled as an estimate).
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

inline constexpr const char* kIntentSchemaVersion = "zero-echo.intent.v1";
inline constexpr const char* kPromptVersion = "zero-echo.prompt.ru.v1";  // shared/prompt.ts PROMPT_VERSION
// Estimated tokens of the fixed system prompt + user scaffold of shared/prompt.ts (zero-echo.prompt.ru.v1),
// measured once with estimateTokens(); counted in the total so the 1800-token budget is honest.
inline constexpr int kFixedPromptTokens = 429;

struct OfferedAction {
  std::string id;
  std::vector<std::string> targets, companions;
  bool target_required = false;
  int fact_min = 0, fact_max = 0;
};

struct Offer {
  std::vector<OfferedAction> actions;
  std::vector<std::string> visible_facts;
  std::int64_t world_revision = 0;
  const OfferedAction* find(const std::string& id) const;
};

// What the game allows `actor` to do right now in `sit` (before budget pruning).
Offer compute_offer(const Core& c, const std::string& actor, const Situation& sit);
// Re-derives the typed offer from a GatewayRequest JSON (the single source of truth for a dispatched request).
Offer offer_from_request(const json::Value& request);

// Facts visible to `actor` in `sit`: own knowledge ∩ relevant to the situation, never protected, sorted by relevance.
std::vector<std::string> visible_facts(const Core& c, const std::string& actor, const Situation& sit);
// Entities the situation is about (focus, order target, alarm sensor and zone, actor zone, ...).
std::vector<std::string> situation_entities(const Core& c, const std::string& actor, const Situation& sit);

// Full GatewayRequest per schemas/gateway_request.schema.json.
json::Value build_gateway_request(const Core& c, const QueueItem& item, double now_ms);

// Once a request is resolved only step 1 can still see it (late or duplicate deliveries): keep the action ids,
// fact limits and visible fact ids, drop the bulky context. Keeps saves and the state hash small.
void compact_resolved_request(PendingRequest& rec);

// Recent events this NPC could know about, rendered in Russian (oldest first, at most `limit`).
std::vector<std::string> recent_events_for(const Core& c, const std::string& actor, std::size_t limit);

}  // namespace echo
