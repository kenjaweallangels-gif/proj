// Game rules shared by ContextBuilder (what to offer), UtilityPolicy (what to choose) and Intent Authority
// (what to accept). Each check returns "" when the rule holds, otherwise a machine reason code
// "<code>:<detail>"; reason_ru() renders it for UI traces.
//
// `ignore_plan` names a plan being re-validated on the player's accept: resources and tools it reserved count
// as available to it and its own soft reservations do not block it.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

// The drone flies; its operator stays at the dock (no travel, no EVA for the operator).
bool is_remote_action(const ActionDef& a);
// Who physically performs the action: the target for propose_rest of someone else, otherwise the actor.
std::string executor_of(const ActionDef& a, const std::string& actor, const std::string& target);
// Zone where the work happens (rest: a pressurized zone; remote: the operator's zone).
std::string work_zone_for(const Core& c, const ActionDef& a, const std::string& executor, const std::string& target);
// Whether the action needs the player's approval (approval: always | never | if_companion | if_target_other).
bool needs_approval(const ActionDef& a, const std::string& actor, const std::string& target, const std::string& companion);

std::string role_check(const Core& c, const std::string& actor, const ActionDef& a);
std::string cooldown_check(const Core& c, const std::string& actor, const ActionDef& a);
std::string actor_state_check(const Core& c, const std::string& actor, const ActionDef& a, const std::string& ignore_plan);
std::string resources_check(const Core& c, const ActionDef& a, const std::string& ignore_plan);
std::string tools_check(const Core& c, const ActionDef& a, const std::string& ignore_plan);
std::string target_check(const Core& c, const std::string& actor, const ActionDef& a, const std::string& target,
                         const std::string& ignore_plan);
std::string companion_check(const Core& c, const std::string& actor, const ActionDef& a, const std::string& companion,
                            const std::string& target, const std::string& ignore_plan);

// Free for a companion role: NPC, not executing a task, not proposing or soft-reserved by another plan.
bool companion_available(const Core& c, const std::string& id, const std::string& ignore_plan);

// Russian explanation of a reason code for authority traces and Decision reasons.
std::string reason_ru(const Core& c, const std::string& code);
// Short refusal category used by ControlledSpeech (power, secret, eva, busy, role, route, resource, invalid, generic).
std::string refusal_category(const std::string& code);

}  // namespace echo
