// Task system (Документ §8 «Практическое действие»): travel over the door graph (a few sim seconds per hop,
// airlock cycles for closed doors) -> work (duration_s) -> done. Effects and resource consumption happen ONLY
// at completion; cancelling releases reservations without effects.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

struct TaskSpec {
  std::string action, executor, companion, target, proposer, origin, source, style, gesture;
  std::vector<std::string> fact_ids;
  // When the reservation was already made by a plan, start_task takes it over instead of reserving again.
  std::string from_plan;
};

// Creates the task, makes the hard reservation (resources, tools, people) and starts travel.
// Instant actions (duration 0) complete immediately. Returns the task id.
std::string start_task(Core& c, const TaskSpec& spec, double now_ms);
void advance_tasks(Core& c, std::int64_t dt_ms, double now_ms);
// Cancels an active task: releases reservations and tool locks, applies no effects.
bool cancel_task(Core& c, const std::string& task_id, const std::string& reason);
// Free movement (returning home after work) and derived activity labels.
void advance_walks(Core& c, std::int64_t dt_ms);
void update_activities(Core& c);
void update_fatigue(Core& c, std::int64_t dt_ms);

// Facts that an inspection of `target` would reveal right now (inspection_reveals with conditions).
std::vector<std::string> inspection_facts(const Core& c, const std::string& target);

}  // namespace echo
