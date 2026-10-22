// Immutable D0 data loaded by the `init` command: world, crew, actions, profiles, controlled speech,
// director events and place-biography rules. Everything is validated (types, cross references) up front,
// so the simulation never has to deal with dangling ids.
#pragma once

#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "echo/json.hpp"

namespace echo {

struct Reading {
  double value = 0.0;
  std::string trend = "stable";
};

struct ZoneDef {
  std::string id, name_ru, kind;
  bool pressurized = true;
  bool suit_required = false;
  std::vector<std::string> anchors;
};

struct DoorDef {
  std::string id, a, b, state;  // state: open | closed | sealed
  double cycle_s = 0.0;         // airlock cycle time; 0 for plain doors
};

struct ResourceDef {
  std::string id, name_ru, unit;
  double amount = 0.0, min_safe = 0.0;
};

struct ItemDef {
  std::string id, name_ru, zone, kind;
};

struct SensorDef {
  std::string id, name_ru, zone, kind, unit;
  Reading truth, reading;
  std::string fault;  // empty when healthy
};

struct FactDef {
  std::string id, layer;  // layer: physical | instrument | interpretation | history | canon
  bool is_protected = false;
  std::string text_ru;
  std::vector<std::string> about;
};

struct KnowledgeSeed {
  std::string fact, source;
};

struct HistoryEventDef {
  std::string id, type, summary_ru;
  double time_s = 0.0;
  std::vector<std::string> actors;
};

struct OpinionSeed {
  std::string about, text_ru, source;
  double confidence = 0.5;
};

struct TriggerReveal {
  std::string fact, source;
  std::vector<std::string> to;
};

struct ScriptedTrigger {
  std::string id, type, sensor;
  double at_time_s = 0.0;
  Reading reading;
  std::vector<TriggerReveal> reveal;
  bool has_initiative = false;
  std::string initiative_actor, initiative_kind, initiative_situation_ru;
};

struct InspectionReveal {
  std::string target, condition;  // condition: always | sensor_fault_active
  std::vector<std::string> reveal;
};

struct ActionDef {
  std::string id, label_ru, description_ru;
  std::vector<std::string> target_kinds;  // sensor | zone | item | actor
  bool target_required = false;
  std::vector<std::string> zone_kinds, item_kinds, others_roles;
  bool self_allowed = false;
  std::string companion = "none";  // none | optional
  int fact_min = 0, fact_max = 0;
  std::vector<std::string> roles;  // "*" = any
  std::vector<std::pair<std::string, double>> min_skill;
  std::vector<std::string> tools;
  std::vector<std::pair<std::string, double>> consumes;
  double duration_s = 0.0, cooldown_s = 0.0;
  std::string approval = "never";  // never | always | if_companion | if_target_other
  std::vector<std::string> effects;
  std::string gesture_default = "none";

  bool instant() const { return duration_s <= 0.0; }
};

struct PhysicalRules {
  double eva_max_fatigue = 0.85;
  double eva_min_skill = 0.5;
  bool busy_actor_can_be_companion = false;
};

struct PolicyWeights {
  double safety = 0.5, curiosity = 0.5, efficiency = 0.5, social = 0.5, self_care = 0.5;
};

struct NpcDef {
  std::string id, name_ru, role_ru, role, zone;
  bool is_player = false;
  std::string values_ru, style_ru, boundaries_ru, quirks_ru;
  std::vector<std::pair<std::string, double>> skills;
  double fatigue = 0.0, health = 1.0, trust_player = 0.5;
  std::vector<std::pair<std::string, double>> relationships;
  PolicyWeights weights;
  std::array<double, 3> color{0.7, 0.7, 0.7};

  double skill(const std::string& name) const;
};

struct GpuGateConfig {
  double p95_gpu_ms_max = 11.5, p99_frame_ms_max = 14.0, vram_reserve_gib_min = 1.5;
  double stable_window_s = 2.0, cooldown_s = 5.0, stats_max_age_s = 1.0;
};

struct AdmissionConfig {
  int max_active_generations = 1;
  int max_queue_length = 4;
  std::map<std::string, double> deadline_ms;  // direct_reply, initiative, ambient
  std::map<std::string, int> priority;        // emergency, direct_reply, initiative, ambient
  GpuGateConfig gate;
  int cpu_threads_min = 2, cpu_threads_max = 6;
  int max_input_tokens = 1800, max_output_tokens = 160;
  std::map<std::string, std::pair<int, int>> layer_tokens;  // layer -> [min, max]
};

struct Profiles {
  double frame_budget_ms = 16.667;
  double pause_threshold_ms = 33.3;
  AdmissionConfig admission;
};

// ---------- data/speech_ru.json ----------
struct NameForms {
  std::string nom, gen, dat, acc, ins, prep;
  const std::string& form(const std::string& c) const;
};

struct SpeechTemplate {
  std::string id, kind, stage, action, text, gesture;
  std::vector<std::string> actors, styles;
  // Conditions ("when"); empty string / -1 means "any".
  std::string when_known_fact, when_situation, when_target_kind, when_target, when_result_fact, when_reason,
      when_say_intent;
  int when_companion = -1;    // 1 requires a companion, 0 requires none
  int when_target_self = -1;  // 1 target == actor, 0 target is someone else
  // Derived from slots in the text.
  bool needs_target = false, needs_companion = false, needs_fact = false;
};

struct AliasPattern {
  std::string target;                              // entity id or "*sensor"
  std::vector<std::vector<std::string>> tokens;    // token alternatives; "x*" = prefix
};

struct SayIntentPattern {
  std::string intent;
  std::vector<std::vector<std::vector<std::string>>> patterns;  // pattern -> tokens -> alternatives
};

struct SpeechData {
  int anti_repeat_window = 4;
  std::vector<SpeechTemplate> templates;
  std::map<std::string, NameForms> names;
  std::vector<AliasPattern> aliases;
  std::vector<SayIntentPattern> say_intents;
};

// ---------- data/director_events.json ----------
struct DirectorEffect {
  std::string type;  // sound | instrument_distortion | interpretation
  std::string zone, cue, text_ru;            // sound
  std::string sensor, trend;                 // instrument_distortion
  double value = 0.0, duration_s = 0.0;      // instrument_distortion
  std::string fact, holder, source;          // interpretation
  double confidence = 0.5;
};

struct DirectorFactReq {
  std::string holder;  // player | witness | any
  std::string fact;
};

struct DirectorEventDef {
  std::string id, label_ru, level;
  double tension_cost = 0.1, max_tension_before = 1.0, cooldown_s = 60.0, chance = 0.2;
  double window_from_s = 0.0, window_to_s = 1e12;
  std::vector<DirectorFactReq> requires_facts;
  std::vector<std::string> incompatible, witness_candidates, witness_zones, tags;
  bool no_emergency = true;
  std::vector<std::string> no_task_near;  // zones that must have no active emergency-type task
  double min_since_last_echo_s = 0.0;
  std::string zone_checked, zone_checked_fact;
  bool witness_idle = true;
  std::vector<DirectorEffect> effects;
  bool has_initiative = false;
  std::string initiative_situation_ru, initiative_focus;
  double recovery_after_s = 0.0;
  std::string recovery_type = "none";  // none | restore_instruments
};

struct DirectorData {
  double tension_initial = 0.1, decay_per_s = 0.003, evaluate_every_s = 5.0, max_tension = 0.75;
  double emergency_tension = 0.6, calm_window_s = 90.0;
  double min_gap_s = 60.0;  // minimum time between any two director events
  std::vector<std::string> allowed_effect_types;
  std::vector<std::string> emergency_task_actions;
  std::vector<DirectorEventDef> events;
};

// ---------- data/biography_details.json ----------
struct BioAnchor {
  std::string id, zone, role;
};

struct BioDetailDef {
  std::string id, label_ru, journal_kind, place, place_actor;
  std::string actor;  // trigger only for entries by this actor (empty = anyone)
  std::vector<std::string> roles, pair;
  int min_count = 1;
  bool collision = false, by_non_owner = false, with_companion = false;
  int priority = 1;
};

struct BiographyData {
  double min_clearance_m = 1.2;
  int max_details_per_zone = 3;
  std::vector<std::string> blocked_roles;
  std::map<std::string, BioAnchor> anchors;
  std::map<std::string, std::string> tool_owner;  // item id -> owner actor id
  std::vector<BioDetailDef> details;
};

// Optional data/scene/d0_layout.json subset used to validate biography placement distances.
struct LayoutData {
  bool present = false;
  std::map<std::string, std::array<double, 3>> anchors;
  std::map<std::string, std::array<double, 3>> stand_points;
};

struct StaticData {
  std::string world_id, title_ru, player_id;
  std::uint64_t world_seed = 0;
  std::vector<ZoneDef> zones;
  std::vector<DoorDef> doors;
  std::vector<ResourceDef> resources;
  std::vector<ItemDef> items;
  std::vector<SensorDef> sensors;
  std::vector<FactDef> facts;
  std::map<std::string, std::vector<KnowledgeSeed>> initial_knowledge;
  std::vector<HistoryEventDef> history;
  std::map<std::string, std::vector<OpinionSeed>> initial_opinions;
  std::vector<ScriptedTrigger> triggers;
  std::vector<InspectionReveal> inspection_reveals;

  std::vector<NpcDef> crew;  // player first, then NPCs in file order
  std::vector<std::string> styles, gestures;
  PhysicalRules physical;
  std::vector<ActionDef> actions;
  Profiles profiles;
  SpeechData speech;
  DirectorData director;
  BiographyData biography;
  LayoutData layout;

  std::string data_hash;  // FNV-1a of the canonical init data; saves must match it

  const ZoneDef* zone(const std::string& id) const;
  const DoorDef* door(const std::string& id) const;
  const ResourceDef* resource(const std::string& id) const;
  const ItemDef* item(const std::string& id) const;
  const SensorDef* sensor(const std::string& id) const;
  const FactDef* fact(const std::string& id) const;
  const ActionDef* action(const std::string& id) const;
  const NpcDef* npc(const std::string& id) const;  // includes the player
  // Russian label of any entity id (zone, item, sensor, actor); the id itself when unknown.
  std::string label(const std::string& id) const;
  // Entity kind: zone | item | sensor | actor | "" when unknown.
  std::string kind_of(const std::string& id) const;
  // Zone where a static entity lives (zones map to themselves; items/sensors by definition).
  std::string home_zone_of(const std::string& id) const;
};

// Parses and validates the `data` object of the init command. On failure returns false with a Russian
// message naming the offending path.
bool load_static_data(const json::Value& data, StaticData& out, std::string& error);

}  // namespace echo
