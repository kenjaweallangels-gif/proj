// Snapshots, save/load and the deterministic state hash. The hash is FNV-1a 64 over the canonical
// (sorted-key) serialization of the complete game state, so the same seed and the same command sequence give
// the same hash on every target, and load(save(x)) reproduces it exactly. No KV cache is ever saved:
// personality lives in memory with sources, the event log and accepted intents.
#pragma once

#include <string>

#include "echo/state.hpp"

namespace echo {

inline constexpr const char* kCoreVersion = "echo-core 0.1.0";
inline constexpr const char* kSaveFormat = "zero-echo.save.v1";

json::Value state_to_json(const State& st);
json::Value state_to_json(const State& st, bool with_events);
bool state_from_json(const json::Value& v, State& out, std::string& error);
// FNV-1a 64 over the canonical serialization of the state, where the append-only event log is represented by
// its own FNV-1a chain digest (maintained incrementally, so hashing stays cheap as the log grows).
std::string state_hash(const Core& c);
void reset_event_digest(const Core& c);

// SPEC §1.1 snapshot (`state` command). `debug` adds physical truth, entity revisions and pending requests.
json::Value snapshot_json(const Core& c, bool debug, double now_ms, bool with_hash = true);

json::Value make_save(const Core& c);
// Restores a save made with the same data (data_hash must match). Verifies the stored hash.
bool load_save(Core& c, const json::Value& save, std::string& error_code, std::string& error_message);

}  // namespace echo
