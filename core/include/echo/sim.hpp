// One simulation step: request deadlines, scripted triggers, tasks and walking, plan TTLs, fatigue,
// director, observations of the ordinary game AI. Uses simulation time only; host time (now_ms) is used
// solely for AI request deadlines.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

// Advances the world by dt_ms. Returns task ids of AI requests that expired (fallback already applied).
std::vector<std::string> sim_tick(Core& c, std::int64_t dt_ms, double now_ms);
// Applies a scripted trigger (sensor fault: instrument reading changes, physical truth stays).
void fire_trigger(Core& c, const ScriptedTrigger& t, double now_ms);

}  // namespace echo
