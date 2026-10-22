// Bounded horror director (Документ §13, SPEC §6). Events have a tension cost, cooldown, story window,
// required facts, incompatibilities, witnesses and a safe recovery. The director may only add sounds,
// temporarily distort INSTRUMENT readings and give a witness an INTERPRETATION — it never touches physical
// stocks or truth, never changes built modules and never proves the finale. Deterministic (seeded RNG).
#pragma once

#include <string>

#include "echo/state.hpp"

namespace echo {

void director_tick(Core& c, std::int64_t dt_ms, double now_ms);
void director_on_emergency_start(Core& c);
void director_on_emergency_end(Core& c);

// "" when the event may fire now (and `witness` is chosen), otherwise the failed precondition code.
std::string director_check(const Core& c, const DirectorEventDef& ev, std::string& witness);
// Applies an event's effects (tests may force it after checking preconditions).
void director_fire(Core& c, const DirectorEventDef& ev, const std::string& witness, double now_ms);

json::Value director_json(const Core& c);

}  // namespace echo
