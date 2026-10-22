// World model helpers shared by the simulation modules: initial state, semantic revisions, the
// append-only event log, NPC knowledge/memory, door-graph routing and physical rules.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

// Event sources (Документ §12 «журнал подтверждённых событий»).
inline constexpr const char* kSrcSim = "sim";
inline constexpr const char* kSrcPlayer = "player";
inline constexpr const char* kSrcAgent = "agent_accepted";
inline constexpr const char* kSrcDirector = "director";
inline constexpr const char* kSrcFallback = "fallback";

// Builds the initial State from static data (actors, resources, knowledge, history, opinions).
void init_state(Core& c, std::uint64_t seed);

// Bumps the global semantic revision once and stamps every listed entity with it.
void bump_revision(Core& c, const std::vector<std::string>& entities);
std::int64_t entity_rev(const Core& c, const std::string& entity);

// Appends to the event log and to the current command's output buffer.
const Event& emit(Core& c, const std::string& type, const std::string& actor, json::Value payload,
                  const std::string& source);
json::Value event_json(const Event& e);
// Protocol form: event_json plus `text_ru`, a readable Russian line for transcripts and UI.
json::Value event_json_ru(const Core& c, const Event& e);

// ---------- actors ----------
ActorState* actor(Core& c, const std::string& id);
const ActorState* actor(const Core& c, const std::string& id);
bool is_npc(const Core& c, const std::string& id);
// Executing a task or flagged busy by debug_patch. Proposers of pending plans are not "busy" for others.
bool actor_busy(const Core& c, const std::string& id);
std::string name_of(const Core& c, const std::string& id);

// ---------- knowledge and memory ----------
bool knows(const Core& c, const std::string& actor, const std::string& fact);
const KnownFact* known_fact(const Core& c, const std::string& actor, const std::string& fact);
// Records a fact in the actor's knowledge with its source; also adds a `fact` memory entry. Protected facts
// are never learned by NPCs (they belong to the canon, not to anyone's memory). Returns true if new.
bool learn(Core& c, const std::string& actor, const std::string& fact, const std::string& source);
// Re-confirms an already known fact with a fresh source (e.g. a new inspection).
void reconfirm(Core& c, const std::string& actor, const std::string& fact, const std::string& source);
MemoryEntry& remember(Core& c, const std::string& actor, const std::string& kind, const std::string& text_ru,
                      const std::string& source, double importance, std::vector<std::string> tags,
                      double confidence = -1.0);

// ---------- routing and physics ----------
struct Route {
  bool ok = false;
  std::vector<std::string> zones;  // zones[0] == from
  std::vector<std::string> doors;  // doors crossed, zones.size() - 1 entries
  std::string blocked_reason;      // when !ok
};
// Breadth-first search over doors that are not sealed; never enters a sealed zone.
Route find_route(const Core& c, const std::string& from, const std::string& to);
// Duration of crossing a door: walking time plus airlock cycle for closed doors.
std::int64_t hop_duration_ms(const Core& c, const std::string& door_id);
// Physical rules for suit-required zones along a route (excluding the start zone).
bool eva_ok(const Core& c, const std::string& actor, const std::vector<std::string>& zones, std::string& why);
bool zone_requires_suit(const Core& c, const std::string& zone);

double resource_free(const Core& c, const std::string& resource);
bool sensor_fault_active(const Core& c, const std::string& sensor_or_zone);
std::string zone_of_entity(const Core& c, const std::string& id);  // current zone (actors move, items may move)

// Readable Russian line for an event (transcripts and recent_events context).
std::string describe_event_ru(const Core& c, const Event& e);

}  // namespace echo
